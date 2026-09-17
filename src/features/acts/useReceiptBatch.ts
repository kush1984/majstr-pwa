import { useCallback, useRef, useState } from 'react';
import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { actsApi } from '@/api/acts.ts';
import { toAppError } from '@/api/errors.ts';
import { BATCH_QR_BUDGET_MS, decodeQrFromFile, looksFiscal } from '@/lib/qr.ts';
import { newUuid } from '@/lib/uuid.ts';
import { addActReceipt, patchQueuedReceiptFromRead } from './offlineReceipts.ts';
import { actKey, useActWriter } from './useActs.ts';
import type {
  ActReceiptRecognizeResponse,
  WorkActReceiptResponse,
  WorkActResponse,
} from '@/api/types.ts';

/** One photo that made it to a row, and how — the queued ones are not addressable by network. */
interface SavedReceipt {
  receipt: WorkActReceiptResponse;
  file: File;
  queued: boolean;
}

/**
 * What both rungs read off a receipt, normalised: a blank label is no label.
 *
 * `fiscalFn`/`fiscalId` come from the QR rung ONLY — a vision read never produces them and a
 * hand-written товарний чек has none. Carrying them is what lets the server notice this slip is
 * already filed against the object (B-04) and, at sign time, stop it being billed and costed twice.
 * The object side has sent them since V129; the act side not doing so is exactly why the
 * cross-check had nothing to compare on one whole half of every pair.
 */
interface ReceiptRead {
  label: string | null;
  amount: number;
  issuedAt: string | null;
  fiscalFn: string | null;
  fiscalId: string | null;
}

/** What the master chose once for the whole batch, before a single byte was uploaded. */
export interface ReceiptBatchChoice {
  /** Read the amounts with the model. The QR rung runs either way — it is local, exact and free. */
  withAi: boolean;
  /** File a second copy of each photo under the object's «Чеки» folder. */
  saveToPhotos: boolean;
}

export interface ReceiptBatchProgress {
  phase: 'saving' | 'reading';
  done: number;
  total: number;
}

export interface ReceiptBatchOutcome {
  saved: number;
  /** The photos were queued on the device, not uploaded — there was no connection. */
  offline: boolean;
  failed: number;
  /** Saved, but still without a sum — the master types these in by hand. */
  unread: number;
  /** The first upload error, if any: N identical toasts for one bad batch help nobody. */
  error: string | null;
}

/**
 * Add a pile of receipt photos to one act in a single gesture (receipts-batch).
 *
 * <p>The order is the whole point and it is inverted from what this feature used to do. Reading
 * used to happen BEFORE the row existed, so a weak connection did not delay a receipt — it LOST
 * it, together with the photo the master had already taken («з недостатньою швидкістю інтернету
 * довго думає і додавати чек не хоче»). Here every photo becomes a saved row first, named «Чек №N»
 * by the server and priced 0 = «not read yet»; only then does anything try to read it, and a read
 * that fails, times out or is abandoned costs the master nothing but a sum he types himself.</p>
 *
 * <p>Two rungs per receipt, cheapest first. The fiscal QR printed on the paper is decoded LOCALLY
 * and is exact, so it runs on every photo regardless of what was chosen — it spends no model call.
 * The model runs only when the master asked for it, and it reads the photo ALREADY stored, so a
 * slow read never re-uploads and never blocks. Both rungs read the same three things — who issued
 * it, when, and for how much: a receipt is re-billed as a whole, its positions are never carried
 * into the act (removed 2026-08-28).</p>
 */
export function useReceiptBatch(actId: string, projectId: string) {
  const invalidate = useActWriter(actId, projectId);
  const qc = useQueryClient();
  const [progress, setProgress] = useState<ReceiptBatchProgress | null>(null);
  const cancelled = useRef(false);

  /** One receipt, cheapest rung first. Returns null when nothing could be read — a normal outcome. */
  const readOne = useCallback(
    async (
      receipt: WorkActReceiptResponse,
      file: File,
      choice: ReceiptBatchChoice,
      queued: boolean,
    ): Promise<ActReceiptRecognizeResponse | null> => {
      try {
        // Budgeted at a fraction of the single-photo sweep: jsqr is synchronous, and ten full
        // ladders would freeze the phone for a minute for an enrichment that is optional by design.
        const payload = await decodeQrFromFile(file, { budgetMs: BATCH_QR_BUDGET_MS });
        if (payload && looksFiscal(payload)) {
          const read = await actsApi.readReceiptQr(actId, payload);
          if (read.recognized && read.amount != null) return read;
        }
      } catch {
        // A photo with no readable fiscal code is the common case, not a failure. Fall through.
      }
      if (!choice.withAi) return null;
      // A queued receipt has no stored photo to read: its id is a client uuid the server has never
      // seen, so this call is a 404. The catch below swallows it into «nothing was read», which
      // looks exactly like a model that found nothing — which is how it went unnoticed.
      if (queued) return null;
      try {
        const read = await actsApi.recognizeStoredReceipt(actId, receipt.id);
        return read.recognized ? read : null;
      } catch {
        // A model that timed out on a weak link leaves an unpriced row, which is exactly the
        // state this feature was rebuilt to make legal. Never a lost receipt, never a toast storm.
        return null;
      }
    },
    [actId],
  );

  /**
   * Put what was read onto the row — without flattening what the master typed while it was reading.
   *
   * <p>Phase 2 lasts as long as the pile takes, and every card is on screen and editable
   * throughout: he prices «Чек №1» by hand while «Чек №5» is still with the model. The PATCH
   * carries the row's WHOLE state, so each field sent over an answer he has already given is an
   * overwrite — including {@code returnedAmount}, which was erased back to 0 by being left out.</p>
   *
   * <p>«Already answered» is simply «no longer what we saved a moment ago»: the server creates the
   * row as «Чек №N» priced 0 with no date, so a field that has moved since was moved BY HIM. Same
   * rule the single-photo read in ActReceiptsSection follows.</p>
   */
  const applyRead = useCallback(
    async (entry: SavedReceipt, read: ReceiptRead) => {
      // Never uploaded, so there is no server row to PATCH — the queued create IS the row. False
      // means the queue drained meanwhile and the replay landed it under that same uuid, so the
      // ordinary PATCH below now addresses something real.
      if (entry.queued && (await patchQueuedReceiptFromRead(entry.receipt.id, read))) return;

      const before = entry.receipt;
      const now =
        qc.getQueryData<WorkActResponse>(actKey(actId))?.receipts.find((r) => r.id === before.id)
        ?? before;
      await actsApi.updateReceipt(actId, before.id, {
        label: now.label !== before.label ? now.label : (read.label ?? before.label),
        amount: now.amount !== before.amount ? now.amount : read.amount,
        issuedAt:
          now.issuedAt !== before.issuedAt ? now.issuedAt : (read.issuedAt ?? before.issuedAt),
        returnedAmount: now.returnedAmount,
        // Not three-valued, unlike everything above: the identity belongs to the PHOTO, so there is
        // no «he changed it meanwhile» to preserve, and a null simply leaves it alone.
        fiscalFn: read.fiscalFn,
        fiscalId: read.fiscalId,
      });
    },
    [actId, qc],
  );

  const run = useCallback(
    async (files: File[], choice: ReceiptBatchChoice): Promise<ReceiptBatchOutcome> => {
      cancelled.current = false;
      // Read once, before the loop: whether this batch was uploaded or queued has to be ONE answer
      // for the whole pile, or the closing toast describes a state that never existed.
      const online = onlineManager.isOnline();
      const saved: SavedReceipt[] = [];
      let failed = 0;
      let error: string | null = null;

      setProgress({ phase: 'saving', done: 0, total: files.length });
      for (const [i, file] of files.entries()) {
        if (cancelled.current) break;
        try {
          // A per-file client UUID: a retry over a weak link is exactly where this batch lives, and
          // a duplicated receipt is duplicated money — in the act AND in the ADDENDUM it rolls into.
          // `queued` is per FILE, not per batch: the link can die on photo 4 of 5, and the two
          // kinds of row are corrected through completely different doors.
          const { row, queued } = await addActReceipt(actId, {
            id: newUuid(),
            amount: 0,
            file,
            saveToPhotos: choice.saveToPhotos,
          });
          saved.push({ receipt: row, file, queued });
        } catch (err) {
          failed += 1;
          error ??= toAppError(err).message;
        }
        setProgress({ phase: 'saving', done: i + 1, total: files.length });
      }
      invalidate(); // the rows exist now — show them before anything is read

      let unread = 0;
      // Every rung of the read needs the network — the fiscal QR is decoded on the phone but
      // resolved by the tax service, and the model obviously runs nowhere near it. Offline the
      // paper is simply filed and the sums are the master's to type, which is the state this
      // whole flow was rebuilt to make legal.
      if (!online) {
        unread = saved.length;
      } else if (saved.length > 0) {
        setProgress({ phase: 'reading', done: 0, total: saved.length });
        for (const [i, entry] of saved.entries()) {
          if (cancelled.current) {
            unread += saved.length - i;
            break;
          }
          const read = await readOne(entry.receipt, entry.file, choice, entry.queued);
          const amount = read?.amount ?? 0;
          if (read && amount > 0) {
            try {
              // The server already named it «Чек №N»; a reader's guess replaces that only when it
              // actually read a name off the paper.
              await applyRead(entry, {
                label: read.label?.trim() || null, amount, issuedAt: read.issuedAt,
                fiscalFn: read.fiscalFn, fiscalId: read.fiscalId,
              });
            } catch (err) {
              unread += 1;
              error ??= toAppError(err).message;
            }
          } else {
            unread += 1;
          }
          setProgress({ phase: 'reading', done: i + 1, total: saved.length });
        }
        invalidate();
      }

      setProgress(null);
      return { saved: saved.length, offline: !online, failed, unread, error };
    },
    [actId, applyRead, invalidate, readOne],
  );

  const cancel = useCallback(() => {
    cancelled.current = true;
  }, []);

  return { progress, run, cancel };
}
