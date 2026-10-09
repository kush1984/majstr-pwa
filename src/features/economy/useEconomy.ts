import { roundMoney } from '@/lib/decimal.ts';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { economyApi } from '@/api/economy.ts';
import { CLIENT_DRIVEN_QUERY } from '@/lib/clientDrivenQuery.ts';
import { paymentsApi } from '@/api/payments.ts';
import { estimatesApi } from '@/api/estimates.ts';
import { newUuid } from '@/lib/uuid.ts';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import type {
  ObjectEconomyResponse,
  PaymentReceiptEditRequest,
  PaymentReceiptRequest,
  PaymentReceiptResponse,
  PaymentsSummaryResponse,
  PaymentSplitRequest,
  PaymentSurplusTransferRequest,
  ProjectPaymentRequest,
  ProjectPaymentResponse,
  ProjectPaymentStatus,
} from '@/api/types.ts';

/**
 * Query key for one object's economy.
 *
 * <p>`expenses` went with the journal SCREEN: nothing has read `['object-expenses', …]` since
 * «Прибуток» came off the object, so invalidating it refreshed nothing while reading as if it did
 * (review P-48/P-52). An expense is still written — a till receipt flipped to «моя витрата» posts
 * one — and the surface that shows it now is «Мої гроші», which is what the writers invalidate.</p>
 */
export const economyKeys = {
  economy: (objectId: string) => ['object-economy', objectId] as const,
};

/**
 * Stop the fetch an optimistic patch is about to overwrite (review P-31).
 *
 * <p>Every patch in this module writes into the ONE economy key, and a GET already in flight
 * resolves after it with server state that does not yet hold the queued op — so a payment the
 * master has just recorded leaves the screen again for the length of that request. On a money
 * screen that is the worst place for it to happen.</p>
 */
const cancelEconomy = (qc: QueryClient, objectId: string) => () =>
  qc.cancelQueries({ queryKey: economyKeys.economy(objectId) });

/**
 * The economy tab's data — panels + payments are FREE-visible, so this is always fetched
 * (unlike the expense journal below, which stays PRO-gated). `internals` comes back null for
 * FREE; the section renders the lock teaser for that part only.
 */
export function useEconomy(objectId: string) {
  return useQuery({
    ...CLIENT_DRIVEN_QUERY,
    queryKey: economyKeys.economy(objectId),
    queryFn: () => economyApi.economy(objectId),
    enabled: Boolean(objectId),
  });
}

/** «Не враховувати цей акт» / «Враховувати» — the act's own ⋮ menu (economy-polish iteration;
 *  moved off the Кошторис tab, which only ever shows unsigned drafts now). `objectId` doubles as
 *  the project id everywhere in this module. */
export function useToggleEstimateCounted(objectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { estimateId: string; value: boolean }) =>
      estimatesApi.setCountInEconomy(v.estimateId, v.value),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: economyKeys.economy(objectId) });
      void qc.invalidateQueries({ queryKey: ['project-estimates', objectId] });
      // `progress` skips an estimate that does not count, which is the whole point of the toggle:
      // an open act editor reading the old progress would still offer lines it may no longer
      // close, and the object card reads Σ SIGNED ∧ counted (review P-48).
      void qc.invalidateQueries({ queryKey: ['act-progress'] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** Mirrors ProjectPayment.status(today, received) server-side — used only for the brief
 *  optimistic window before a real fetch confirms the authoritative value (offline only; see
 *  offlineMutate — this never runs on a normal online success). */
function deriveStageStatus(amount: number, received: number, dueDate: string | null): ProjectPaymentStatus {
  if (received >= amount) return 'RECEIVED';
  if (received > 0) return 'PARTIAL';
  if (dueDate && dueDate < new Date().toISOString().slice(0, 10)) return 'OVERDUE';
  return 'PLANNED';
}

function patchPayments(
  qc: QueryClient,
  objectId: string,
  edit: (list: ProjectPaymentResponse[]) => ProjectPaymentResponse[],
): void {
  qc.setQueryData<ObjectEconomyResponse>(economyKeys.economy(objectId), (old) => {
    // A payment mutation is PRO-gated (economy-polish iteration), so `old.payments` is only ever
    // null here if the cache is stale/mid-fetch — nothing to patch optimistically in that case.
    if (!old || !old.payments) return old;
    return { ...old, payments: { ...old.payments, payments: edit(old.payments.payments) } };
  });
}

/** Same guard as patchPayments, but hands the edit function the WHOLE summary — for receipt
 *  mutations, which touch both a stage's nested history and the object-level totals at once. */
function patchSummary(
  qc: QueryClient,
  objectId: string,
  edit: (summary: PaymentsSummaryResponse) => PaymentsSummaryResponse,
): void {
  qc.setQueryData<ObjectEconomyResponse>(economyKeys.economy(objectId), (old) => {
    if (!old || !old.payments) return old;
    return { ...old, payments: edit(old.payments) };
  });
}

/** Returns the created stage (not void) — the "surplus transfer" hint (see PaymentSheet) needs
 *  the new stage's real id to target the transfer at. */


export function useAddPayment(objectId: string) {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: (req: ProjectPaymentRequest) => {
      const id = newUuid();
      return offlineMutate<ProjectPaymentResponse>({
        entity: 'project-payment', entityId: id, type: 'create', payload: { objectId, req },
        deps: [objectId],
        online: () => paymentsApi.add(objectId, req, id),
        cancel: cancelEconomy(qc, objectId),
        onOnlineSuccess: () => void qc.invalidateQueries({ queryKey: economyKeys.economy(objectId) }),
        optimistic: () => {
          const created: ProjectPaymentResponse = {
            id, amount: req.amount, dueDate: req.dueDate ?? null, nextStage: req.nextStage ?? null,
            purpose: req.purpose, received: 0, remaining: req.amount,
            status: deriveStageStatus(req.amount, 0, req.dueDate ?? null),
            sortOrder: 0, receipts: [],
          };
          patchPayments(qc, objectId, (list) => [...list, { ...created, sortOrder: list.length }]);
          return created;
        },
      });
    },
  });
}

export function useUpdatePayment(objectId: string) {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ id, req }: { id: string; req: ProjectPaymentRequest }) =>
      offlineMutate<void>({
        entity: 'project-payment', entityId: id, type: 'update', payload: { objectId, req },
        deps: [objectId],
        online: async () => { await paymentsApi.update(objectId, id, req); },
        cancel: cancelEconomy(qc, objectId),
        onOnlineSuccess: () => void qc.invalidateQueries({ queryKey: economyKeys.economy(objectId) }),
        optimistic: () => patchPayments(qc, objectId, (list) => list.map((p) => (p.id === id ? {
          ...p, amount: req.amount, dueDate: req.dueDate ?? null, nextStage: req.nextStage ?? null,
          purpose: req.purpose, status: deriveStageStatus(req.amount, p.received, req.dueDate ?? null),
        } : p))),
      }),
  });
}

export function useDeletePayment(objectId: string) {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: (paymentId: string) =>
      offlineMutate<void>({
        entity: 'project-payment', entityId: paymentId, type: 'delete', payload: { objectId },
        deps: [objectId],
        online: async () => { await paymentsApi.remove(objectId, paymentId); },
        cancel: cancelEconomy(qc, objectId),
        onOnlineSuccess: () => void qc.invalidateQueries({ queryKey: economyKeys.economy(objectId) }),
        optimistic: () => patchPayments(qc, objectId, (list) => list.filter((p) => p.id !== paymentId)),
      }),
  });
}

// ---------------------------------------------------------------------------
// FACT — payment_receipt (V100). The one path money enters through.
// ---------------------------------------------------------------------------

/** The common case: a partial/full close against a known stage, or an unplanned receipt — no
 *  overpayment. Offline-first, single entity id, mirrors useAddPayment. The optimistic patch is a
 *  simplification (it doesn't model RESERVE/INCREASE bumping the plan amount) — acceptable since
 *  it only ever shows while offline; the next sync replaces it with the server's real numbers. */
export function useAddReceipt(objectId: string) {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: async (req: PaymentReceiptRequest) => {
      const id = newUuid();
      const result = await offlineMutate<PaymentReceiptResponse[]>({
        entity: 'payment-receipt', entityId: id, type: 'create', payload: { objectId, req },
        // The targeted stage is a dep, not just the object: a stage added in the same offline
        // session carries a client-generated id that only exists on the server once ITS create
        // has replayed, and a receipt naming it earlier would 404.
        deps: req.planPaymentId ? [objectId, req.planPaymentId] : [objectId],
        online: () => paymentsApi.addReceipt(objectId, req, id),
        cancel: cancelEconomy(qc, objectId),
        onOnlineSuccess: () => void qc.invalidateQueries({ queryKey: economyKeys.economy(objectId) }),
        optimistic: () => {
          const label = req.label?.trim() || null;
          const refund = req.materialRefund === true;
          // Money handed back for material arrives, but it buys no work: it raises «Прийшло» and
          // leaves «Залишилось» exactly where it was (review B-65). The server applies the same
          // split — and clamps it against what is actually reimbursable — on the next read.
          const paysWork = refund ? 0 : req.amount;
          const receipt: PaymentReceiptResponse = {
            id, planPaymentId: req.planPaymentId ?? null, label,
            displayLabel: label ?? 'Оплата', amount: req.amount, receivedAt: req.receivedAt,
            materialRefund: refund,
          };
          patchSummary(qc, objectId, (s) => {
            if (!req.planPaymentId) {
              // In kopecks (review P-59): 4 000,30 − 1 000,10 is 3000.2000000000003 in floats, and
              // that figure then pre-filled a field its own reader refuses.
              return {
                ...s, received: roundMoney(s.received + req.amount),
                remaining: Math.max(0, roundMoney(s.remaining - paysWork)),
                workPaid: roundMoney(s.workPaid + paysWork),
                materialRefunds: roundMoney(s.materialRefunds + (refund ? req.amount : 0)),
                unplannedReceipts: [...s.unplannedReceipts, receipt],
              };
            }
            const payments = s.payments.map((p) => {
              if (p.id !== req.planPaymentId) return p;
              const received = roundMoney(p.received + paysWork);
              return {
                ...p, received, remaining: Math.max(0, roundMoney(p.amount - received)),
                status: deriveStageStatus(p.amount, received, p.dueDate),
                receipts: [...p.receipts, { ...receipt, label: null, displayLabel: p.purpose }],
              };
            });
            return {
              ...s, payments, received: roundMoney(s.received + req.amount),
              remaining: Math.max(0, roundMoney(s.remaining - paysWork)),
              workPaid: roundMoney(s.workPaid + paysWork),
              materialRefunds: roundMoney(s.materialRefunds + (refund ? req.amount : 0)),
            };
          });
          return [receipt];
        },
      });
      // Wait for the cache to actually be fresh before the mutation resolves — an invalidated
      // query only starts a background refetch, so a master submitting several receipts against
      // the same stage back-to-back could otherwise reopen "Отримати платіж" while the sheet
      // still shows pre-mutation numbers, under-detecting a real overflow (money-critical: the
      // client's own overflow check is what decides whether the confirm dialog even shows).
      await qc.refetchQueries({ queryKey: economyKeys.economy(objectId), type: 'active' });
      return result;
    },
  });
}

/** TRANSFER creates TWO receipts from one submission (this stage's closing amount + the surplus
 *  on the next open stage) — doesn't fit the outbox's one-entity-per-op model, so it's online-only,
 *  same as split preview/commit.
 *
 *  It still carries a client id (review P-61): the server answers a replay under the same id with
 *  BOTH rows it wrote (B-69), and without one a retry after a lost response recorded the overflow a
 *  second time. The caller holds the id for the life of one submission, so a second tap is a replay. */
export function useAddReceiptTransfer(objectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ req, id }: { req: PaymentReceiptRequest; id: string }) => {
      const result = await paymentsApi.addReceipt(objectId, req, id);
      await qc.refetchQueries({ queryKey: economyKeys.economy(objectId), type: 'active' }); // see useAddReceipt
      return result;
    },
  });
}

export function useEditReceipt(objectId: string) {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ id, req }: { id: string; req: PaymentReceiptEditRequest }) =>
      offlineMutate<PaymentReceiptResponse>({
        entity: 'payment-receipt', entityId: id, type: 'update', payload: { objectId, req },
        deps: [objectId],
        online: () => paymentsApi.editReceipt(objectId, id, req),
        cancel: cancelEconomy(qc, objectId),
        onOnlineSuccess: () => void qc.invalidateQueries({ queryKey: economyKeys.economy(objectId) }),
        optimistic: () => {
          let updated: PaymentReceiptResponse | null = null;
          const editOne = (r: PaymentReceiptResponse): PaymentReceiptResponse => {
            if (r.id !== id) return r;
            const label = r.planPaymentId ? r.label : (req.label?.trim() || r.label);
            updated = { ...r, amount: req.amount, receivedAt: req.receivedAt, label,
              // Three-valued like the server's: an omitted tick leaves the answer alone.
              materialRefund: req.materialRefund ?? r.materialRefund,
              displayLabel: r.planPaymentId ? r.displayLabel : (label ?? r.displayLabel) };
            return updated;
          };
          patchSummary(qc, objectId, (s) => ({
            ...s,
            payments: s.payments.map((p) => ({ ...p, receipts: p.receipts.map(editOne) })),
            unplannedReceipts: s.unplannedReceipts.map(editOne),
          }));
          return updated ?? { id, planPaymentId: null, label: req.label ?? null,
            displayLabel: req.label ?? 'Оплата', amount: req.amount, receivedAt: req.receivedAt,
            materialRefund: req.materialRefund ?? false };
        },
      }),
  });
}

export function useDeleteReceipt(objectId: string) {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: (receiptId: string) =>
      offlineMutate<void>({
        entity: 'payment-receipt', entityId: receiptId, type: 'delete', payload: { objectId },
        deps: [objectId],
        online: async () => { await paymentsApi.removeReceipt(objectId, receiptId); },
        cancel: cancelEconomy(qc, objectId),
        onOnlineSuccess: () => void qc.invalidateQueries({ queryKey: economyKeys.economy(objectId) }),
        optimistic: () => patchSummary(qc, objectId, (s) => ({
          ...s,
          payments: s.payments.map((p) => ({ ...p, receipts: p.receipts.filter((r) => r.id !== receiptId) })),
          unplannedReceipts: s.unplannedReceipts.filter((r) => r.id !== receiptId),
        })),
      }),
  });
}

/** "На «X» отримано більше — перенести сюди?" follow-up, offered when creating a new plan stage
 *  while another one is over-received (RESERVE). Online-only, same reasoning as split/TRANSFER —
 *  it mutates two stages' receipt histories server-side in one call. */
export function useTransferSurplus(objectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: PaymentSurplusTransferRequest) => paymentsApi.transferSurplus(objectId, req),
    onSuccess: () => void qc.invalidateQueries({ queryKey: economyKeys.economy(objectId) }),
  });
}

/** Split preview/commit are online-only (they read the live contracted total server-side to
 *  compute the rows) — no offline queueing, same as save-as-template or apply-a-template. */
export function usePreviewSplit(objectId: string) {
  return useMutation({
    mutationFn: (req: PaymentSplitRequest) => paymentsApi.previewSplit(objectId, req),
  });
}

export function useCommitSplit(objectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: PaymentSplitRequest) => paymentsApi.commitSplit(objectId, req),
    onSuccess: () => void qc.invalidateQueries({ queryKey: economyKeys.economy(objectId) }),
  });
}
