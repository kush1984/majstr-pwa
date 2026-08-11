import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { economyApi } from '@/api/economy.ts';
import { paymentsApi } from '@/api/payments.ts';
import { estimatesApi } from '@/api/estimates.ts';
import { newUuid } from '@/lib/uuid.ts';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import type {
  ExpenseRequest,
  ExpenseResponse,
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

/** Query keys for one object's economy + expense journal. */
export const economyKeys = {
  economy: (objectId: string) => ['object-economy', objectId] as const,
  expenses: (objectId: string) => ['object-expenses', objectId] as const,
};

/**
 * The economy tab's data — panels + payments are FREE-visible, so this is always fetched
 * (unlike the expense journal below, which stays PRO-gated). `internals` comes back null for
 * FREE; the section renders the lock teaser for that part only.
 */
export function useEconomy(objectId: string) {
  return useQuery({
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
    },
  });
}

export function useExpenses(objectId: string, enabled: boolean) {
  return useQuery({
    queryKey: economyKeys.expenses(objectId),
    queryFn: () => economyApi.listExpenses(objectId),
    enabled,
  });
}

/** Any mutation invalidates BOTH the list and the summary (profit changes). */
function useInvalidateEconomy(objectId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: economyKeys.economy(objectId) });
    void qc.invalidateQueries({ queryKey: economyKeys.expenses(objectId) });
  };
}

/**
 * Expense CRUD — offline-first. A master logs a purchase standing in the shop, which is
 * exactly where the signal dies. Economy is PRO-gated, and the prefetch already skips it on
 * FREE, so a FREE master never has a cached journal to edit — the gate stays aligned.
 *
 * <p>Only the expense LIST is patched optimistically, not the profit summary: that figure
 * mixes estimate income, deposits and a completed-object settlement rule that lives on the
 * server. Showing a locally re-derived profit risks it disagreeing with the real one — the
 * list is the honest part, and the summary refreshes on sync.
 */
export function useAddExpense(objectId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateEconomy(objectId);
  return useMutation({
    networkMode: 'always',
    mutationFn: (req: ExpenseRequest) => {
      const id = newUuid();
      return offlineMutate<void>({
        entity: 'expense', entityId: id, type: 'create', payload: { objectId, req },
        deps: [objectId],
        online: async () => { await economyApi.addExpense(objectId, req, id); },
        onOnlineSuccess: invalidate,
        optimistic: () => patchExpenses(qc, objectId, (list) => [{
          id, amount: req.amount, category: req.category,
          source: req.source ?? 'MANUAL', note: req.note ?? null,
          spentAt: req.spentAt ?? new Date().toISOString().slice(0, 10),
          createdAt: new Date().toISOString(),
        }, ...list]),
      });
    },
  });
}

export function useUpdateExpense(objectId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateEconomy(objectId);
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ id, req }: { id: string; req: ExpenseRequest }) =>
      offlineMutate<void>({
        entity: 'expense', entityId: id, type: 'update', payload: { objectId, req },
        deps: [objectId],
        online: async () => { await economyApi.updateExpense(objectId, id, req); },
        onOnlineSuccess: invalidate,
        optimistic: () => patchExpenses(qc, objectId, (list) => list.map((e) => (e.id === id
          ? { ...e, amount: req.amount, category: req.category, note: req.note ?? null,
              spentAt: req.spentAt ?? e.spentAt }
          : e))),
      }),
  });
}

export function useDeleteExpense(objectId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateEconomy(objectId);
  return useMutation({
    networkMode: 'always',
    mutationFn: (expenseId: string) =>
      offlineMutate<void>({
        entity: 'expense', entityId: expenseId, type: 'delete', payload: { objectId },
        deps: [objectId],
        online: async () => { await economyApi.deleteExpense(objectId, expenseId); },
        onOnlineSuccess: invalidate,
        optimistic: () => patchExpenses(qc, objectId, (list) => list.filter((e) => e.id !== expenseId)),
      }),
  });
}

function patchExpenses(
  qc: QueryClient,
  objectId: string,
  edit: (list: ExpenseResponse[]) => ExpenseResponse[],
): void {
  qc.setQueryData<ExpenseResponse[]>(economyKeys.expenses(objectId), (old) => edit(old ?? []));
}

// ---------------------------------------------------------------------------
// Object-level payments (завдаток + графік) — FREE + PRO, offline-first like
// expenses above. The list lives inside the economy query's `payments.payments`
// (no separate cache); a mutation patches that nested array and lets the summary
// totals (contracted/received/remaining) go stale until the next real fetch —
// same reasoning useAddExpense gives for not re-deriving profit locally.
// ---------------------------------------------------------------------------

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
        deps: [objectId],
        online: () => paymentsApi.addReceipt(objectId, req, id),
        onOnlineSuccess: () => void qc.invalidateQueries({ queryKey: economyKeys.economy(objectId) }),
        optimistic: () => {
          const label = req.label?.trim() || null;
          const receipt: PaymentReceiptResponse = {
            id, planPaymentId: req.planPaymentId ?? null, label,
            displayLabel: label ?? 'Оплата', amount: req.amount, receivedAt: req.receivedAt,
          };
          patchSummary(qc, objectId, (s) => {
            if (!req.planPaymentId) {
              return {
                ...s, received: s.received + req.amount, remaining: Math.max(0, s.remaining - req.amount),
                unplannedReceipts: [...s.unplannedReceipts, receipt],
              };
            }
            const payments = s.payments.map((p) => {
              if (p.id !== req.planPaymentId) return p;
              const received = p.received + req.amount;
              return {
                ...p, received, remaining: Math.max(0, p.amount - received),
                status: deriveStageStatus(p.amount, received, p.dueDate),
                receipts: [...p.receipts, { ...receipt, label: null, displayLabel: p.purpose }],
              };
            });
            return { ...s, payments, received: s.received + req.amount, remaining: Math.max(0, s.remaining - req.amount) };
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
 *  same as split preview/commit. */
export function useAddReceiptTransfer(objectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (req: PaymentReceiptRequest) => {
      const result = await paymentsApi.addReceipt(objectId, req);
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
        onOnlineSuccess: () => void qc.invalidateQueries({ queryKey: economyKeys.economy(objectId) }),
        optimistic: () => {
          let updated: PaymentReceiptResponse | null = null;
          const editOne = (r: PaymentReceiptResponse): PaymentReceiptResponse => {
            if (r.id !== id) return r;
            const label = r.planPaymentId ? r.label : (req.label?.trim() || r.label);
            updated = { ...r, amount: req.amount, receivedAt: req.receivedAt, label,
              displayLabel: r.planPaymentId ? r.displayLabel : (label ?? r.displayLabel) };
            return updated;
          };
          patchSummary(qc, objectId, (s) => ({
            ...s,
            payments: s.payments.map((p) => ({ ...p, receipts: p.receipts.map(editOne) })),
            unplannedReceipts: s.unplannedReceipts.map(editOne),
          }));
          return updated ?? { id, planPaymentId: null, label: req.label ?? null,
            displayLabel: req.label ?? 'Оплата', amount: req.amount, receivedAt: req.receivedAt };
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
