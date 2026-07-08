import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { economyApi } from '@/api/economy.ts';
import type { ExpenseRequest } from '@/api/types.ts';

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
    qc.invalidateQueries({ queryKey: economyKeys.economy(objectId) });
    qc.invalidateQueries({ queryKey: economyKeys.expenses(objectId) });
  };
}

export function useAddExpense(objectId: string) {
  const invalidate = useInvalidateEconomy(objectId);
  return useMutation({
    mutationFn: (req: ExpenseRequest) => economyApi.addExpense(objectId, req),
    onSuccess: invalidate,
  });
}

export function useUpdateExpense(objectId: string) {
  const invalidate = useInvalidateEconomy(objectId);
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: ExpenseRequest }) =>
      economyApi.updateExpense(objectId, id, req),
    onSuccess: invalidate,
  });
}

export function useDeleteExpense(objectId: string) {
  const invalidate = useInvalidateEconomy(objectId);
  return useMutation({
    mutationFn: (expenseId: string) => economyApi.deleteExpense(objectId, expenseId),
    onSuccess: invalidate,
  });
}
