import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { projectReceiptsApi } from '@/api/projectReceipts.ts';
import { economyKeys } from '@/features/economy/useEconomy.ts';
import type { ProjectReceiptRequest } from '@/api/types.ts';

export const projectReceiptsKey = (projectId: string) => ['project-receipts', projectId] as const;

export function useProjectReceipts(projectId: string) {
  return useQuery({
    queryKey: projectReceiptsKey(projectId),
    queryFn: () => projectReceiptsApi.list(projectId),
    enabled: Boolean(projectId),
  });
}

/**
 * Invalidate everything one receipt write touches. The economy is NOT an optional extra here: the
 * materials axis is computed from exactly these rows, and flipping «це моя витрата» also posts or
 * removes an object expense — so a stale economy tab would show a receivable the master has just
 * moved, which is the one thing this feature exists to keep straight.
 *
 * <p>Exported so the batch, which drives the API directly to keep per-file control, refreshes
 * exactly what the mutations do.</p>
 */
export function useProjectReceiptsWriter(projectId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: projectReceiptsKey(projectId) });
    void qc.invalidateQueries({ queryKey: economyKeys.economy(projectId) });
    void qc.invalidateQueries({ queryKey: economyKeys.expenses(projectId) });
  };
}

export function useUpdateProjectReceipt(projectId: string) {
  const invalidate = useProjectReceiptsWriter(projectId);
  return useMutation({
    mutationFn: ({ receiptId, req }: { receiptId: string; req: ProjectReceiptRequest }) =>
      projectReceiptsApi.update(projectId, receiptId, req),
    onSuccess: invalidate,
  });
}

export function useDeleteProjectReceipt(projectId: string) {
  const invalidate = useProjectReceiptsWriter(projectId);
  return useMutation({
    mutationFn: (receiptId: string) => projectReceiptsApi.remove(projectId, receiptId),
    onSuccess: invalidate,
  });
}
