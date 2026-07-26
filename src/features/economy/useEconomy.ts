import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { economyApi } from '@/api/economy.ts';
import { newUuid } from '@/lib/uuid.ts';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import type { ExpenseRequest, ExpenseResponse } from '@/api/types.ts';

/** Query keys for one object's economy + expense journal. */
export const economyKeys = {
  economy: (objectId: string) => ['object-economy', objectId] as const,
  expenses: (objectId: string) => ['object-expenses', objectId] as const,
};

export function useEconomy(objectId: string, enabled: boolean) {
  return useQuery({
    queryKey: economyKeys.economy(objectId),
    queryFn: () => economyApi.economy(objectId),
    enabled,
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
