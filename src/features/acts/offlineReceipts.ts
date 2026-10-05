import { useCallback, useEffect, useState } from 'react';
import { onlineManager } from '@tanstack/react-query';
import { actsApi } from '@/api/acts.ts';
import { downscaleImage } from '@/lib/image.ts';
import { isNetworkError } from '@/lib/outbox/offlineMutation.ts';
import {
  dropPendingCreate,
  enqueue,
  listOutbox,
  patchPendingCreate,
} from '@/lib/outbox/outbox.ts';
import { fromQueuedFile, toQueuedFile, type QueuedFile } from '@/lib/outbox/queuedFile.ts';
import { useSyncStatus } from '@/lib/useOnline.ts';
import type { WorkActReceiptResponse } from '@/api/types.ts';

/**
 * Adding a receipt to an act without a connection (offline-act-receipts).
 *
 * <p>This was the last daily flow that could not author offline, and it is the one where that hurt
 * most: a receipt is a piece of paper the master is holding in a building with no signal, and the
 * photo of it is the only proof it ever existed. Every other write on this screen already survived
 * a dead link; this one asked him to remember to come back.</p>
 *
 * <p>The queued op is a CREATE and nothing else. Correcting or dropping a receipt that has not
 * synced yet is done to the op itself ({@link patchQueuedReceipt} / {@link dropQueuedReceipt}), not
 * as a second op: there is no server row to address, and a correction made before the queue drains
 * is not a second fact about the receipt — it is what the receipt always was, as far as the server
 * will ever know.</p>
 */
export const ACT_RECEIPT_ENTITY = 'actReceipt';

/** What a queued receipt carries. Its shape is the outbox handler's contract — see outbox/init.ts. */
export interface ActReceiptOpPayload {
  actId: string;
  label?: string;
  amount: number;
  issuedAt?: string | null;
  saveToPhotos?: boolean;
  /** What the printed QR said, decoded ON THE DEVICE — the identity travels with the create. */
  fiscalFn?: string | null;
  fiscalId?: string | null;
  file: QueuedFile;
}

/** A receipt sitting in the queue, with its photo rebuilt as a File the UI can render. */
export interface QueuedActReceipt {
  id: string;
  payload: ActReceiptOpPayload;
  file: File;
}

/** The saved receipt, and WHICH of the two ways it was saved. */
export interface AddedActReceipt {
  row: WorkActReceiptResponse;
  /**
   * The photo went into the outbox instead of over the wire.
   *
   * <p>Then `row.id` is a client uuid THE SERVER HAS NEVER SEEN, and every network call addressed
   * to it — reading the stored photo, PATCHing the sum onto it — is a 404. The caller cannot infer
   * this from the connection: {@link addActReceipt} falls back to the queue on a network error too,
   * so a batch that began online can queue its fourth photo and upload its fifth.</p>
   */
  queued: boolean;
}

/**
 * Save one receipt photo — over the network when there is one, into the outbox when there is not.
 *
 * <p>Deliberately not {@link import('@/lib/outbox/offlineMutation.ts').offlineMutate}: that helper
 * takes the payload eagerly, and building this one costs real work — a re-encode and a full copy of
 * the photo's bytes. On the online path (the common one, and a batch of ten photos at that) none of
 * that is needed, so the queued payload is built only on the branch that queues.</p>
 *
 * <p>No `deps`: an act is always a server row by the time it can hold receipts — the editor refuses
 * receipts until the act is saved, and acts are not created offline.</p>
 */
export async function addActReceipt(
  actId: string,
  req: {
    id: string; amount: number; file: File; saveToPhotos?: boolean;
    fiscalFn?: string | null; fiscalId?: string | null;
  },
): Promise<AddedActReceipt> {
  if (onlineManager.isOnline()) {
    try {
      return { row: await actsApi.addReceipt(actId, req), queued: false };
    } catch (e) {
      if (!isNetworkError(e)) throw e; // a real refusal (signed act, bad file) must surface
    }
  }
  const payload: ActReceiptOpPayload = {
    actId,
    amount: req.amount,
    saveToPhotos: req.saveToPhotos,
    fiscalFn: req.fiscalFn ?? null,
    fiscalId: req.fiscalId ?? null,
    // Downscaled before it is queued, not before it is sent: these bytes live in IndexedDB until
    // the master finds signal, and a pile of 6 MB phone photos is how a device runs out of quota
    // holding work it has not lost yet.
    file: await toQueuedFile(await downscaleImage(req.file)),
  };
  await enqueue({
    entityId: req.id,
    entity: ACT_RECEIPT_ENTITY,
    type: 'create',
    payload,
    deps: [],
  });
  return { row: queuedReceiptRow(req.id, payload), queued: true };
}

/**
 * The row a queued receipt shows as, until it lands.
 *
 * <p>It is UNNAMED on purpose. «Чек №N» is the server's name for a receipt and only the server can
 * give it: N counts the act's receipts, which a phone holding three unsent photos cannot know. A
 * device-side guess would name every photo of a batch «Чек №1» and then be overwritten anyway.</p>
 */
export function queuedReceiptRow(id: string, p: ActReceiptOpPayload): WorkActReceiptResponse {
  return {
    id,
    label: p.label ?? '',
    amount: p.amount,
    // Not on the create endpoint, so a return typed before the receipt lands has nowhere to go —
    // the form says so instead of dropping it silently. A return happens after the shop anyway.
    returnedAmount: 0,
    issuedAt: p.issuedAt ?? null,
    hasPhoto: true,
    itemized: false,
    sortOrder: 0,
  };
}

/** Correct a receipt that has not synced yet, in the queue. False = it drained; re-read and retry. */
export function patchQueuedReceipt(
  id: string,
  fields: { label: string; amount: number; issuedAt: string | null },
): Promise<boolean> {
  return patchPendingCreate(ACT_RECEIPT_ENTITY, id, (payload) => ({
    ...(payload as ActReceiptOpPayload),
    label: fields.label,
    amount: fields.amount,
    issuedAt: fields.issuedAt,
  }));
}

/**
 * Write what a READER made of a queued receipt into it, without flattening the master's own typing.
 *
 * <p>Separate from {@link patchQueuedReceipt}, which overwrites all three fields on purpose — that
 * one carries what the master just typed into the dialog, including a label he deliberately
 * cleared. This one carries a guess, and a guess loses to a figure: the batch reads photo 5 while
 * the master is pricing photo 1, so by the time the reader answers, the row it is answering about
 * may already say what he wants it to say.</p>
 */
export function patchQueuedReceiptFromRead(
  id: string,
  read: {
    label: string | null; amount: number; issuedAt: string | null;
    fiscalFn?: string | null; fiscalId?: string | null;
  },
): Promise<boolean> {
  return patchPendingCreate(ACT_RECEIPT_ENTITY, id, (raw) => {
    const payload = raw as ActReceiptOpPayload;
    return {
      ...payload,
      label: payload.label?.trim() ? payload.label : (read.label ?? payload.label),
      // A queued receipt is created at 0 — «not priced yet» — so anything above it is his.
      amount: payload.amount > 0 ? payload.amount : read.amount,
      issuedAt: payload.issuedAt ?? read.issuedAt,
      // NOT three-valued, unlike the three above: the identity belongs to the PHOTO, so there is
      // no «he changed it meanwhile» to preserve — but a read that found no code must not erase
      // one a previous rung did.
      fiscalFn: read.fiscalFn ?? payload.fiscalFn ?? null,
      fiscalId: read.fiscalId ?? payload.fiscalId ?? null,
    };
  });
}

/**
 * How many of ONE act's receipts the phone is still carrying, asked straight at the queue.
 *
 * <p>Not the hook: the hook's state is a snapshot taken when the queue's size last changed, and
 * the question «is anything left NOW» is asked immediately after a flush, before React has
 * re-rendered anything (review P-36). A BLOCKED op does not count — flushing will never move it,
 * so it is the master's to resolve in the sync sheet rather than something to wait for.</p>
 */
export async function actReceiptsStillQueued(actId: string): Promise<number> {
  const ops = await listOutbox();
  return ops.filter((op) => op.entity === ACT_RECEIPT_ENTITY
    && op.type === 'create'
    && op.status !== 'blocked'
    && (op.payload as ActReceiptOpPayload).actId === actId).length;
}

/**
 * Drop every queued receipt of an act that is being DELETED (review P-50).
 *
 * <p>Left behind, each replayed a POST against an act the server no longer has — a 404 for every
 * photo, landing in the sync sheet as work the master must resolve, for a draft he threw away.
 * Returns how many were dropped, which is also how many photos are being discarded with it.</p>
 */
export async function dropQueuedReceiptsOfAct(actId: string): Promise<number> {
  const ops = await listOutbox();
  const mine = ops.filter((op) => op.entity === ACT_RECEIPT_ENTITY
    && (op.payload as ActReceiptOpPayload).actId === actId);
  let dropped = 0;
  for (const op of mine) {
    if (await dropPendingCreate(ACT_RECEIPT_ENTITY, op.entityId)) dropped += 1;
  }
  return dropped;
}

/** Delete a receipt that has not synced yet — dropping the op IS deleting the row. */
export function dropQueuedReceipt(id: string): Promise<boolean> {
  return dropPendingCreate(ACT_RECEIPT_ENTITY, id);
}

/**
 * The receipts of one act that are still in the queue, keyed by id.
 *
 * <p>Re-read whenever the queue's size changes (an enqueue, a flush), plus on demand via the
 * returned `refresh` — an edit made in place changes no count. A File already handed out is reused
 * rather than rebuilt, so the photo beside a row does not blink every time another photo of the
 * same batch is queued.</p>
 */
export function usePendingActReceipts(actId: string): {
  queued: Map<string, QueuedActReceipt>;
  /** Ops the SERVER refused. Shown, never counted — see below. */
  rejected: Map<string, QueuedActReceipt>;
  refresh: () => void;
} {
  const { pending, blocked } = useSyncStatus();
  const [version, setVersion] = useState(0);
  const [queued, setQueued] = useState<Map<string, QueuedActReceipt>>(new Map());
  const [rejected, setRejected] = useState<Map<string, QueuedActReceipt>>(new Map());

  useEffect(() => {
    let alive = true;
    void listOutbox().then((ops) => {
      if (!alive) return;
      const mine = ops.filter((op) => op.entity === ACT_RECEIPT_ENTITY
        && op.type === 'create'
        && (op.payload as ActReceiptOpPayload).actId === actId);
      const build = (
        prev: Map<string, QueuedActReceipt>,
        want: (status: string) => boolean,
      ) => {
        const next = new Map<string, QueuedActReceipt>();
        for (const op of mine) {
          if (!want(op.status)) continue;
          const payload = op.payload as ActReceiptOpPayload;
          const before = prev.get(op.entityId);
          next.set(op.entityId, {
            id: op.entityId,
            payload,
            file: before?.file ?? fromQueuedFile(payload.file),
          });
        }
        return next;
      };
      // Two piles, because they are two different answers (review P-36). A receipt still TRYING is
      // money the master has spent and will reach the act, so it is shown and counted. One the
      // server REFUSED will never move on its own — counting it into «До сплати» billed the client
      // for a receipt that was never going to exist, on a document he could sign at any second.
      setQueued((prev) => build(prev, (status) => status !== 'blocked'));
      setRejected((prev) => build(prev, (status) => status === 'blocked'));
    });
    return () => {
      alive = false;
    };
  }, [actId, pending, blocked, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return { queued, rejected, refresh };
}

/**
 * The act's receipts as the master must see them: what the server holds, plus what his phone is
 * still carrying.
 *
 * <p>Queued rows come FIRST, which is the same rule the server sorts by — undated newest-first, so
 * the receipt nobody has typed a date on leads the list. They are merged here rather than written
 * into the query cache because a refetch on reconnect can land before the queue drains, and a
 * receipt blinking out of existence for a few seconds is exactly the fear this feature exists to
 * remove.</p>
 */
export function mergeQueuedReceipts(
  stored: WorkActReceiptResponse[],
  queued: Map<string, QueuedActReceipt>,
): WorkActReceiptResponse[] {
  if (queued.size === 0) return stored;
  const landed = new Set(stored.map((r) => r.id));
  const rows = [...queued.values()]
    .filter((q) => !landed.has(q.id))
    .map((q) => queuedReceiptRow(q.id, q.payload));
  return rows.length === 0 ? stored : [...rows, ...stored];
}
