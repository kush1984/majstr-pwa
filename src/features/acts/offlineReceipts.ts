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
  file: QueuedFile;
}

/** A receipt sitting in the queue, with its photo rebuilt as a File the UI can render. */
export interface QueuedActReceipt {
  id: string;
  payload: ActReceiptOpPayload;
  file: File;
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
  req: { id: string; amount: number; file: File; saveToPhotos?: boolean },
): Promise<WorkActReceiptResponse> {
  if (onlineManager.isOnline()) {
    try {
      return await actsApi.addReceipt(actId, req);
    } catch (e) {
      if (!isNetworkError(e)) throw e; // a real refusal (signed act, bad file) must surface
    }
  }
  const payload: ActReceiptOpPayload = {
    actId,
    amount: req.amount,
    saveToPhotos: req.saveToPhotos,
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
  return queuedReceiptRow(req.id, payload);
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
  refresh: () => void;
} {
  const { pending, blocked } = useSyncStatus();
  const [version, setVersion] = useState(0);
  const [queued, setQueued] = useState<Map<string, QueuedActReceipt>>(new Map());

  useEffect(() => {
    let alive = true;
    void listOutbox().then((ops) => {
      if (!alive) return;
      setQueued((prev) => {
        const next = new Map<string, QueuedActReceipt>();
        for (const op of ops) {
          if (op.entity !== ACT_RECEIPT_ENTITY || op.type !== 'create') continue;
          const payload = op.payload as ActReceiptOpPayload;
          if (payload.actId !== actId) continue;
          const before = prev.get(op.entityId);
          next.set(op.entityId, {
            id: op.entityId,
            payload,
            file: before?.file ?? fromQueuedFile(payload.file),
          });
        }
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [actId, pending, blocked, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return { queued, refresh };
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
