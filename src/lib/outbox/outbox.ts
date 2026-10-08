import { onlineManager } from '@tanstack/react-query';
import { outboxDb } from './db.ts';
import { tokens } from '@/lib/tokens.ts';
import { toAppError } from '@/api/errors.ts';
import type { NewOutboxOp, OutboxHandler, OutboxOp } from './types.ts';

/**
 * The outbox engine: enqueue offline-authored mutations, replay them in order when online.
 *
 * - **Ordering & dependencies:** ops replay in insertion (`seq`) order; an op waits until every
 *   entityId in its `deps` has left the queue (i.e. landed on the server), so a child is never
 *   created before its parent, and a failed parent blocks its children.
 * - **Retry:** each op is attempted at most once per flush; a failure marks it `failed` and leaves
 *   it queued to be retried on the next flush (the next reconnect). Idempotency lives on the
 *   backend (client UUIDs), so a retried create never duplicates.
 */

/** Give up retrying an op after this many failed attempts (a stuck op no longer blocks flushes). */
export const MAX_ATTEMPTS = 8;

/**
 * What one flush did. `blocked` is why it is not just `{synced, failed}` (review P-47): an op the
 * server REFUSED leaves optimistic money on screen — a payment the master can read, that will
 * never exist — and the old caller only refetched when something had LANDED. A refusal is exactly
 * the moment the screen has to go back to what the server actually holds.
 */
export interface FlushResult {
  synced: number;
  /** Entities whose write failed transiently and will be retried. */
  failed: number;
  /** Ops that moved to the terminal `blocked` state during this flush. */
  blocked: number;
}

const handlers = new Map<string, OutboxHandler>();

/** Register the network handler for an entity. Overwrites any previous handler for that key. */
export function registerOutboxHandler(entity: string, handler: OutboxHandler): void {
  handlers.set(entity, handler);
}

// ---- reactive sync status (for the sync-status banner) ---------------------
// A cached snapshot so React can read it synchronously (useSyncExternalStore); updated on every
// enqueue / flush / clear and re-counted from Dexie.

export interface SyncStatus {
  /** Ops still trying to sync (pending or transiently failed) — will retry. */
  pending: number;
  /** Ops the server permanently rejected (e.g. over the FREE limit) — need a user decision. */
  blocked: number;
  /**
   * The part of `pending` that can still reach the server on its own: not blocked, and not waiting
   * (transitively) behind a blocked op. An op held by a refusal stays `pending` until the master
   * resolves the sync sheet, so `pending > 0` can last forever — which is why a gate on it shut
   * the focus refetch app-wide and a client's signature went unseen (review P-55).
   */
  runnable: number;
  /** A flush is in progress right now. */
  syncing: boolean;
}

/** Classifies a handler error: retry it (transient) or block it (permanent — needs the user). */
export type OutboxErrorKind = 'retry' | 'limit' | 'other';
let classifyError: (e: unknown) => OutboxErrorKind = () => 'retry';
export function setOutboxErrorClassifier(fn: (e: unknown) => OutboxErrorKind): void {
  classifyError = fn;
}

let cachedPending = 0;
let cachedBlocked = 0;
let cachedRunnable = 0;
let syncing = false;
let statusSnapshot: SyncStatus = { pending: 0, blocked: 0, runnable: 0, syncing: false };
const statusListeners = new Set<() => void>();

export function getSyncStatus(): SyncStatus {
  return statusSnapshot;
}

export function subscribeSyncStatus(cb: () => void): () => void {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

function emitStatus(): void {
  statusSnapshot = { pending: cachedPending, blocked: cachedBlocked, runnable: cachedRunnable, syncing };
  statusListeners.forEach((l) => l());
}

function setSyncing(v: boolean): void {
  if (syncing !== v) {
    syncing = v;
    emitStatus();
  }
}

/**
 * Every entity a blocked op holds back: the blocked ones themselves, every later op on them, and —
 * transitively — everything depending on one. The same closure `dropBlockedOps` deletes.
 */
function heldEntities(all: OutboxOp[]): Set<string> {
  const held = new Set<string>(all.filter((o) => o.status === 'blocked').map((o) => o.entityId));
  for (let grew = true; grew;) {
    grew = false;
    for (const op of all) {
      if (held.has(op.entityId)) continue;
      if (op.deps.some((d) => held.has(d))) {
        held.add(op.entityId);
        grew = true;
      }
    }
  }
  return held;
}

/** Re-count the queue from Dexie (pending vs blocked vs runnable) and publish if it changed. Never throws. */
async function refreshPending(): Promise<void> {
  try {
    const all = await outboxDb.ops.toArray();
    const blocked = all.filter((o) => o.status === 'blocked').length;
    const pending = all.length - blocked;
    const held = heldEntities(all);
    const runnable = all.filter((o) => o.status !== 'blocked' && !held.has(o.entityId)).length;
    if (pending !== cachedPending || blocked !== cachedBlocked || runnable !== cachedRunnable) {
      cachedPending = pending;
      cachedBlocked = blocked;
      cachedRunnable = runnable;
      emitStatus();
    }
  } catch {
    /* IndexedDB unavailable — leave the last known counts. */
  }
}

/** Prime the cached count at app start (there may be leftover ops from a prior offline session). */
export function initSyncStatus(): void {
  void refreshPending();
}

/** Queue an offline mutation, stamped with the master who authored it. */
export async function enqueue(op: NewOutboxOp): Promise<void> {
  await outboxDb.ops.add({
    ...op,
    // Stamped HERE, not at replay: by the time the queue drains the session may have died
    // and been re-established, and we need to know who actually did the work.
    ownerId: op.ownerId ?? tokens.ownerId() ?? undefined,
    status: 'pending',
    attempts: 0,
    createdAt: op.createdAt ?? Date.now(),
  });
  cachedPending += 1;
  cachedRunnable += 1; // optimistic for the synchronous readers; the re-count below corrects it
  emitStatus();
  void refreshPending();
}

/**
 * Queue an op that states the entity's WHOLE desired state, replacing any queued op just like it.
 *
 * For a reorder this is the only sensible behaviour: dragging four times offline means the master
 * wants the fourth arrangement, and the first three are not history worth replaying — each request
 * overwrites the whole order anyway, so sending them all would cost four round trips to reach the
 * state the last one describes, and would briefly park the server on arrangements the master already
 * abandoned.
 *
 * Only safe for ops carrying full state. A create or a delete must NEVER coalesce — those are
 * distinct facts, not successive drafts of one — which is why this is a separate function rather
 * than a flag on {@link enqueue}.
 *
 * A `blocked` op is left alone: it is waiting on a decision from the master (PRO or delete), and
 * silently dropping it would erase the thing the sync banner is asking them about.
 */
export async function enqueueLatest(op: NewOutboxOp): Promise<void> {
  await outboxDb.transaction('rw', outboxDb.ops, async () => {
    const superseded = await outboxDb.ops
      .where('entityId')
      .equals(op.entityId)
      .filter((o) => o.entity === op.entity && o.type === op.type && o.status !== 'blocked')
      .primaryKeys();
    if (superseded.length > 0) {
      await outboxDb.ops.bulkDelete(superseded);
    }
    await outboxDb.ops.add({
      ...op,
      ownerId: op.ownerId ?? tokens.ownerId() ?? undefined,
      status: 'pending',
      attempts: 0,
      createdAt: op.createdAt ?? Date.now(),
    });
  });
  // Re-counted rather than incremented: this both adds and removes rows.
  await refreshPending();
}

/**
 * Seqs currently being sent — the window between «the request left» and «the op was deleted».
 *
 * <p>In memory, not in IndexedDB, and that is right rather than lazy: only the tab that is
 * flushing can have a request in the air, and a reload ends every one of them. What it buys is
 * {@link patchPendingCreate} and the two drops answering `false` for an op whose POST is already
 * gone — editing its payload then would change nothing the server will ever see, and deleting it
 * would leave the row on the server with nothing left locally to delete it with.</p>
 */
const inFlight = new Set<number>();

/**
 * Edit a create that has not replayed yet, in place.
 *
 * <p>Deliberately NOT a queued `update` op: the entity has no server id, so an update would replay
 * against nothing. A correction made before the queue drains is not a second fact about the row —
 * it is what the row always was, as far as the server will ever know.</p>
 *
 * <p>Returns false when the op is gone (it drained between the read and the write), which is the
 * caller's cue that this is now an ordinary online edit.</p>
 */
export async function patchPendingCreate(
  entity: string,
  entityId: string,
  patch: (payload: unknown) => unknown,
): Promise<boolean> {
  return outboxDb.transaction('rw', outboxDb.ops, async () => {
    const op = await outboxDb.ops
      .where('entityId')
      .equals(entityId)
      .filter((o) => o.entity === entity && o.type === 'create')
      .first();
    if (!op?.seq || inFlight.has(op.seq)) return false;
    await outboxDb.ops.update(op.seq, {
      payload: patch(op.payload),
      // A blocked op edited by the master is a fresh attempt: it was blocked on the CONTENT the
      // server refused, and the content just changed. Leave a `stuck` one blocked — retries ran
      // out for reasons an edit does not fix.
      ...(op.status === 'blocked' && op.blockReason !== 'stuck'
        ? { status: 'pending' as const, attempts: 0 }
        : {}),
    });
    return true;
  });
}

/** Drop a create that has not replayed yet — the offline equivalent of deleting the row. */
export async function dropPendingCreate(entity: string, entityId: string): Promise<boolean> {
  const removed = await outboxDb.ops
    .where('entityId')
    .equals(entityId)
    .filter((o) => o.entity === entity && o.type === 'create'
      && (o.seq === undefined || !inFlight.has(o.seq)))
    .delete();
  if (removed > 0) await refreshPending();
  return removed > 0;
}

/**
 * Drop EVERY queued op of one entity, provided its create is still waiting.
 *
 * <p>Why this is not {@link dropPendingCreate}: add a row offline, tick it, delete it. Dropping
 * only the create left the tick queued, and it replayed as a PATCH on a row the server had never
 * heard of — a 404 the master then had to resolve in the sync sheet, for a row he had already
 * thrown away. The ops after a create are statements ABOUT it, so they go with it.</p>
 *
 * <p>Returns false when there is no pending create (it drained, or its POST is in the air), which
 * is the caller's cue to delete the row the ordinary online way.</p>
 */
export async function dropPendingEntity(entity: string, entityId: string): Promise<boolean> {
  const removed = await outboxDb.transaction('rw', outboxDb.ops, async () => {
    const ops = await outboxDb.ops
      .where('entityId')
      .equals(entityId)
      .filter((o) => o.entity === entity)
      .toArray();
    const create = ops.find((o) => o.type === 'create');
    if (!create?.seq || inFlight.has(create.seq)) return 0;
    const seqs = ops.map((o) => o.seq).filter((s): s is number => s !== undefined);
    await outboxDb.ops.bulkDelete(seqs);
    return seqs.length;
  });
  if (removed > 0) await refreshPending();
  return removed > 0;
}

/** How many ops are still queued (pending or failed). */
export function outboxCount(): Promise<number> {
  return outboxDb.ops.count();
}

/** All queued ops, in replay order — for the sync-status UI. */
export function listOutbox(): Promise<OutboxOp[]> {
  return outboxDb.ops.orderBy('seq').toArray();
}

/** Ops the server permanently rejected (need a "PRO or delete" decision). */
export function listBlockedOps(): Promise<OutboxOp[]> {
  return outboxDb.ops.where('status').equals('blocked').toArray();
}

/** Un-block every blocked op (e.g. after the master upgrades to PRO) and flush again. */
export async function retryBlockedOps(): Promise<{ synced: number; failed: number }> {
  await outboxDb.ops.where('status').equals('blocked').modify((op) => {
    op.status = 'pending';
    op.attempts = 0;
    op.blockReason = undefined;
  });
  await refreshPending();
  return flushOutbox();
}

/**
 * Discard every blocked op AND everything that hangs off it. Returns all dropped entityIds so
 * the caller can purge the matching optimistic cache entries.
 *
 * <p>The cascade is the point. A child only waits while a matching op is still queued, so
 * deleting just the blocked rows RELEASED its dependents to replay against a parent that was
 * never created: offline the master makes project P (blocked — over the FREE cap), estimate E
 * `deps:[P]` and its items; tapping "delete" removed P, then E fired
 * `createForProject(P, …)` → 404 → retried → died at MAX_ATTEMPTS. The master deleted one
 * thing and silently lost three.</p>
 */
export async function dropBlockedOps(): Promise<string[]> {
  const all = await outboxDb.ops.toArray();
  // Transitive closure: an op dies if it targets a doomed entity (a later edit of the same
  // row) or depends on one — a grandchild reaches the dropped parent only through its parent.
  const doomed = heldEntities(all);

  const seqs = all
    .filter((o) => doomed.has(o.entityId) && o.seq !== undefined)
    .map((o) => o.seq as number);
  await outboxDb.ops.bulkDelete(seqs);
  await refreshPending();
  return [...doomed];
}

/**
 * Wipe the queue outright. Never throws — runs in cleanup paths.
 *
 * Reserved for the cases where unsynced work genuinely must not survive: the master chose
 * "discard" at the re-sync prompt. **A dying session is no longer one of them** — see
 * {@link discardForeignOps}.
 */
export async function clearOutbox(): Promise<void> {
  try {
    await outboxDb.ops.clear();
  } catch {
    /* IndexedDB unavailable — nothing to clear. */
  }
  cachedPending = 0;
  cachedBlocked = 0;
  cachedRunnable = 0;
  emitStatus();
}

/**
 * Drop every queued op that does NOT belong to `ownerId`, and report how many remain.
 *
 * Called right after a login. This is what makes keeping the queue across a logout safe: work
 * authored by a different master (or by a pre-v2 build, which carries no owner at all) is
 * destroyed before a single request goes out, so it can never be replayed into the wrong
 * account. What survives is the current master's own unsynced work, which the caller then
 * offers back to them.
 */
export async function discardForeignOps(ownerId: string | null): Promise<number> {
  try {
    const all = await outboxDb.ops.toArray();
    const foreign = all.filter((op) => !ownerId || op.ownerId !== ownerId);
    if (foreign.length > 0) {
      await outboxDb.ops.bulkDelete(foreign.map((op) => op.seq!).filter((s) => s !== undefined));
    }
    const remaining = all.length - foreign.length;
    cachedPending = remaining;
    emitStatus();
    void refreshPending(); // the blocked/runnable split of what survived
    return remaining;
  } catch {
    /* IndexedDB unavailable — treat as an empty queue rather than blocking the login. */
    return 0;
  }
}

let flushing = false;


/**
 * Replay the queue. Repeated passes let a just-synced parent unblock its children within one
 * flush. Each op is tried at most once per flush; deps still in the queue (pending OR failed)
 * hold their dependents back. Concurrency-guarded so overlapping triggers don't double-send.
 */
export async function flushOutbox(): Promise<FlushResult> {
  if (flushing) return { synced: 0, failed: 0, blocked: 0 };
  flushing = true;
  setSyncing(true);
  let synced = 0;
  let blocked = 0;
  const failedEntityIds = new Set<string>();
  const attempted = new Set<number>(); // seq — one attempt per op per flush
  try {
    let progressed = true;
    while (progressed) {
      progressed = false;
      const ops = await outboxDb.ops.orderBy('seq').toArray();
      if (ops.length === 0) break;
      const done = new Set<number>(); // seqs synced in THIS pass (deleted from the DB but still in `ops`)
      const unfinished = (o: OutboxOp) => o.seq !== undefined && !done.has(o.seq);
      for (const op of ops) {
        const seq = op.seq;
        if (seq === undefined || attempted.has(seq)) continue;
        // Per-entity ordering: an update/delete waits for its own create (any earlier op on the
        // SAME entity that hasn't landed) — so we never PUT before the row exists on the server.
        if (ops.some((o) => o.entityId === op.entityId && o.seq !== undefined && o.seq < seq && unfinished(o))) continue;
        // Cross-entity deps: wait for a dependency (e.g. an estimate's object) still unfinished.
        if (op.deps.some((d) => d !== op.entityId && ops.some((o) => o.entityId === d && unfinished(o)))) continue;
        if (op.status === 'blocked') continue; // needs a user decision — never auto-retried
        if (op.attempts >= MAX_ATTEMPTS) {
          // Heals ops left over from a build that only `continue`d here: they sat as
          // `failed` at the cap forever, counted as pending, with no way for the master
          // to see or resolve them. Promote to the terminal state on first sight.
          await outboxDb.ops.update(seq, { status: 'blocked', blockReason: 'stuck' });
          blocked += 1;
          continue;
        }
        const handler = handlers.get(op.entity);
        if (!handler) continue; // no handler (e.g. an entity a newer build owns) — leave it
        attempted.add(seq);
        inFlight.add(seq);
        try {
          await handler(op);
          await outboxDb.ops.delete(seq);
          done.add(seq);
          synced += 1;
          progressed = true;
        } catch (e) {
          const kind = classifyError(e);
          if (kind === 'retry') {
            const attempts = op.attempts + 1;
            if (attempts >= MAX_ATTEMPTS) {
              // Out of retries. This is the moment the write is really lost, so it must
              // become TERMINAL and visible: left as `failed` it was skipped by every later
              // flush yet still counted as pending, so the badge said "syncing…" forever and
              // the master believed the write would land. It never would.
              await outboxDb.ops.update(seq, {
                status: 'blocked', blockReason: 'stuck', attempts, lastError: errMessage(e),
              });
              blocked += 1;
            } else {
              await outboxDb.ops.update(seq, {
                status: 'failed', attempts, lastError: errMessage(e),
              });
              failedEntityIds.add(op.entityId);
            }
          } else {
            // Permanent rejection (over the FREE limit, or another 4xx) — block it for the user to
            // resolve (PRO or delete); do not retry, and it keeps blocking its dependents.
            await outboxDb.ops.update(seq, {
              status: 'blocked', blockReason: kind, lastError: errMessage(e),
            });
            blocked += 1;
          }
        } finally {
          inFlight.delete(seq);
        }
      }
    }
  } finally {
    flushing = false;
    setSyncing(false);
    await refreshPending(); // publish the post-flush queue size
  }
  return { synced, failed: failedEntityIds.size, blocked };
}

/**
 * Whether a finished flush should send the screens back to the server's figures.
 *
 * <p>Only once nothing that can still land is left. A refetch while an op is merely FAILING (a
 * 503, a half-open link) answers with server state that does not hold that op yet, straight over
 * its optimistic row — the line vanished on every 15 s / 30 s / 60 s / 2 min retry, the master
 * typed it again, and the replay later landed both (review P-54). A refusal still refetches (the
 * point of P-47): ops held behind it are not runnable, so they do not keep the screen waiting.</p>
 */
export function shouldRefetchAfterFlush(result: FlushResult): boolean {
  return (result.synced > 0 || result.blocked > 0) && getSyncStatus().runnable === 0;
}

/**
 * Start auto-flushing: flush now, and again whenever the network comes back (TanStack
 * `onlineManager`). Returns an unsubscribe. `onFlush` reports each flush's result to the UI.
 */
/** Backoff for the self-retry below: 15s, 30s, 60s, then every 2 min. */
const RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 120_000];

export function startOutboxSync(onFlush?: (result: FlushResult) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let misses = 0;

  const run = async (): Promise<void> => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    if (!onlineManager.isOnline()) return;
    const result = await flushOutbox();
    onFlush?.(result);
    // Re-arm ONLY while something is still waiting. Previously the sole trigger was an
    // online/offline transition, so a flush that hit a 5xx (or a half-open connection) left the
    // ops sitting there: the phone had signal, the badge said "syncing…", and nothing moved
    // again until the master toggled the network or restarted the app.
    const remaining = await outboxDb.ops
      .filter((o) => o.status !== 'blocked')
      .count()
      .catch(() => 0);
    if (remaining > 0) {
      const delay = RETRY_DELAYS_MS[Math.min(misses, RETRY_DELAYS_MS.length - 1)];
      misses += 1;
      timer = setTimeout(() => void run(), delay);
    } else {
      misses = 0;
    }
  };

  const unsubscribe = onlineManager.subscribe(() => { misses = 0; void run(); });
  // Coming back from the background is the single most valuable trigger on a phone: the master
  // walks out of the basement with the app suspended, so no online/offline event ever fires.
  const onVisible = () => {
    if (document.visibilityState === 'visible') { misses = 0; void run(); }
  };
  document.addEventListener('visibilitychange', onVisible);
  void run();

  return () => {
    unsubscribe();
    document.removeEventListener('visibilitychange', onVisible);
    if (timer !== undefined) clearTimeout(timer);
  };
}

/**
 * What to store on a failed/blocked op — and it must be the SERVER's own words.
 *
 * <p>`e.message` on an axios error is «Request failed with status code 409», which tells the master
 * nothing about the receipt he is looking at. `toAppError` unwraps the backend's localized message,
 * so a blocked op can say «Акт підписано — редагувати не можна» in the sync sheet. That matters
 * most for the ops that can be refused for a reason the master can act on: an act signed on another
 * device while his queue waited is his money, and «сервер не прийняв» is not an answer.</p>
 */
function errMessage(e: unknown): string {
  return toAppError(e).message;
}
