import { useCallback, useRef, useState } from 'react';
import { onlineManager } from '@tanstack/react-query';
import { projectReceiptsApi } from '@/api/projectReceipts.ts';
import { toAppError } from '@/api/errors.ts';
import { BATCH_QR_BUDGET_MS, decodeQrFromFile, looksFiscal } from '@/lib/qr.ts';
import { newUuid } from '@/lib/uuid.ts';
import { useProjectReceiptsWriter } from './useProjectReceipts.ts';
import type { ProjectReceiptResponse, ReceiptRecognizeResponse } from '@/api/types.ts';

/** What the master chose once for the whole batch, before a single byte was uploaded. */
export interface ProjectReceiptBatchChoice {
  /** Read the amounts with the model. The QR rung runs either way — it is local, exact and free. */
  withAi: boolean;
}

export interface ProjectReceiptBatchProgress {
  phase: 'saving' | 'reading';
  done: number;
  total: number;
}

export interface ProjectReceiptBatchOutcome {
  saved: number;
  /** Nothing was attempted — there was no connection, and an object receipt has no outbox. */
  offline: boolean;
  failed: number;
  /** Saved, but still without a sum — the master types these in by hand. */
  unread: number;
  /** The first upload error, if any: N identical toasts for one bad batch help nobody. */
  error: string | null;
}

/**
 * Add a pile of receipt photos to one OBJECT in a single gesture — the act's batch (receipts-batch)
 * applied to «Чеки обʼєкта», and the order is the whole point: every photo becomes a saved row
 * FIRST, named «Чек №N» by the server and priced 0 = «not read yet», and only then does anything
 * try to read it. A read that fails, times out or is abandoned costs the master nothing but a sum
 * he types himself — never the receipt, and never the photo he already took.
 *
 * <p>Two rungs per receipt, cheapest first. The fiscal QR printed on the paper is decoded LOCALLY,
 * is exact and spends no model call, so it runs on every photo regardless of what was chosen — and
 * it is the only rung that returns the paper's identity, which is what lets the server flag a
 * duplicate later. The model runs only when the master asked, and reads the photo ALREADY stored.</p>
 *
 * <p>Two deliberate differences from the act's batch. There is no «зберегти також у Фото» tick —
 * the object's create endpoint has no such parameter, and these receipts already belong to the
 * object. And there is no offline path: an object receipt has no outbox entity, so instead of
 * queueing bytes it cannot send, the batch refuses up front and says so — the honest version of a
 * pile of photos that would otherwise look saved and be gone.</p>
 */
export function useProjectReceiptBatch(projectId: string) {
  const invalidate = useProjectReceiptsWriter(projectId);
  const [progress, setProgress] = useState<ProjectReceiptBatchProgress | null>(null);
  const cancelled = useRef(false);

  /** One receipt, cheapest rung first. Returns null when nothing could be read — a normal outcome. */
  const readOne = useCallback(
    async (
      receipt: ProjectReceiptResponse,
      file: File,
      choice: ProjectReceiptBatchChoice,
    ): Promise<ReceiptRecognizeResponse | null> => {
      try {
        // Budgeted at a fraction of the single-photo sweep: jsqr is synchronous, and ten full
        // ladders would freeze the phone for a minute for an enrichment that is optional by design.
        const payload = await decodeQrFromFile(file, { budgetMs: BATCH_QR_BUDGET_MS });
        if (payload && looksFiscal(payload)) {
          const read = await projectReceiptsApi.readQr(projectId, payload);
          if (read.recognized && read.amount != null) return read;
        }
      } catch {
        // A photo with no readable fiscal code is the common case, not a failure. Fall through.
      }
      if (!choice.withAi) return null;
      try {
        const read = await projectReceiptsApi.recognizeStored(projectId, receipt.id);
        return read.recognized ? read : null;
      } catch {
        // A model that timed out on a weak link leaves an unpriced row, which is exactly the
        // state this flow is built to make legal. Never a lost receipt, never a toast storm.
        return null;
      }
    },
    [projectId],
  );

  const run = useCallback(
    async (
      files: File[],
      choice: ProjectReceiptBatchChoice,
    ): Promise<ProjectReceiptBatchOutcome> => {
      cancelled.current = false;
      // Checked once, before anything is read off disk: an object receipt cannot be queued, so a
      // batch started with no connection must not look like it uploaded anything.
      if (!onlineManager.isOnline()) {
        return { saved: 0, offline: true, failed: files.length, unread: 0, error: null };
      }
      const saved: { receipt: ProjectReceiptResponse; file: File }[] = [];
      let failed = 0;
      let error: string | null = null;

      setProgress({ phase: 'saving', done: 0, total: files.length });
      for (const [i, file] of files.entries()) {
        if (cancelled.current) break;
        try {
          // A per-file client UUID: a retry over a weak link is exactly where this batch lives,
          // and a duplicated receipt is money the client is asked to pay back twice.
          const receipt = await projectReceiptsApi.add(projectId, {
            id: newUuid(),
            amount: 0,
            file,
          });
          saved.push({ receipt, file });
        } catch (err) {
          failed += 1;
          error ??= toAppError(err).message;
        }
        setProgress({ phase: 'saving', done: i + 1, total: files.length });
      }
      invalidate(); // the rows exist now — show them before anything is read

      let unread = 0;
      if (saved.length > 0) {
        setProgress({ phase: 'reading', done: 0, total: saved.length });
        for (const [i, entry] of saved.entries()) {
          if (cancelled.current) {
            unread += saved.length - i;
            break;
          }
          const read = await readOne(entry.receipt, entry.file, choice);
          const amount = read?.amount ?? 0;
          if (read && amount > 0) {
            try {
              await projectReceiptsApi.update(projectId, entry.receipt.id, {
                // The server already named it «Чек №N»; a reader's guess replaces that only when
                // it actually read a name off the paper.
                label: read.label?.trim() || entry.receipt.label,
                amount,
                issuedAt: read.issuedAt ?? entry.receipt.issuedAt,
                // Not sent: `reimbursable` is three-valued, and a read says nothing about whose
                // money this was. Omitting it leaves the default — «клієнт відшкодовує» — alone.
                fiscalFn: read.fiscalFn,
                fiscalId: read.fiscalId,
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
      return { saved: saved.length, offline: false, failed, unread, error };
    },
    [invalidate, projectId, readOne],
  );

  const cancel = useCallback(() => {
    cancelled.current = true;
  }, []);

  return { progress, run, cancel };
}
