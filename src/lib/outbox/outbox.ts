import { onlineManager } from '@tanstack/react-query';
import { outboxDb } from './db.ts';
import { tokens } from '@/lib/tokens.ts';
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
let syncing = false;
let statusSnapshot: SyncStatus = { pending: 0, blocked: 0, syncing: false };
const statusListeners = new Set<() => void>();

export function getSyncStatus(): SyncStatus {
  return statusSnapshot;
}

export function subscribeSyncStatus(cb: () => void): () => void {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

function emitStatus(): void {
  statusSnapshot = { pending: cachedPending, blocked: cachedBlocked, syncing };
  statusListeners.forEach((l) => l());
}

function setSyncing(v: boolean): void {
  if (syncing !== v) {
    syncing = v;
    emitStatus();
  }
}

/** Re-count the queue from Dexie (pending vs blocked) and publish if it changed. Never throws. */
async function refreshPending(): Promise<void> {
  try {
    const total = await outboxDb.ops.count();
    const blocked = await outboxDb.ops.where('status').equals('blocked').count();
    const pending = total - blocked;
    if (pending !== cachedPending || blocked !== cachedBlocked) {
      cachedPending = pending;
      cachedBlocked = blocked;
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
  emitStatus();
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
  const doomed = new Set<string>(
    all.filter((o) => o.status === 'blocked').map((o) => o.entityId),
  );

  // Transitive closure: an op dies if it targets a doomed entity (a later edit of the same
  // row) or depends on one. Repeat until nothing new is added — a grandchild reaches the
  // dropped parent only through its parent.
  for (let grew = true; grew;) {
    grew = false;
    for (const op of all) {
      if (doomed.has(op.entityId)) continue;
      if (op.deps.some((d) => doomed.has(d))) {
        doomed.add(op.entityId);
        grew = true;
      }
    }
  }

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
export async function flushOutbox(): Promise<{ synced: number; failed: number }> {
  if (flushing) return { synced: 0, failed: 0 };
  flushing = true;
  setSyncing(true);
  let synced = 0;
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
          continue;
        }
        const handler = handlers.get(op.entity);
        if (!handler) continue; // no handler (e.g. an entity a newer build owns) — leave it
        attempted.add(seq);
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
          }
        }
      }
    }
  } finally {
    flushing = false;
    setSyncing(false);
    await refreshPending(); // publish the post-flush queue size
  }
  return { synced, failed: failedEntityIds.size };
}

/**
 * Start auto-flushing: flush now, and again whenever the network comes back (TanStack
 * `onlineManager`). Returns an unsubscribe. `onFlush` reports each flush's result to the UI.
 */
export function startOutboxSync(onFlush?: (result: { synced: number; failed: number }) => void): () => void {
  const run = () => {
    if (onlineManager.isOnline()) void flushOutbox().then((r) => onFlush?.(r));
  };
  const unsubscribe = onlineManager.subscribe(() => run());
  run();
  return unsubscribe;
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
