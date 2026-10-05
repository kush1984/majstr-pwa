import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { projectReceiptsApi } from '@/api/projectReceipts.ts';
import { economyKeys } from '@/features/economy/useEconomy.ts';
import type { ProjectReceiptRequest, ProjectReceiptResponse } from '@/api/types.ts';

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
    // «Це моя витрата» posts an `ObjectExpense`, and the screen that shows one is «Мої гроші» —
    // the object's own journal screen is gone, so the key this used to refresh had no reader.
    void qc.invalidateQueries({ queryKey: ['cash'] });
  };
}

/**
 * Edit one receipt — and put the SERVER's answer into the cache before the refetch lands.
 *
 * <p>Without that the master's own edit reached the screen only once the refetch came back, and in
 * between the cache still held the row as it was: the batch reads the cache to decide what he has
 * already answered, so a PATCH racing the refetch could carry the OLD label or amount back over
 * his (review P-01, narrowed then closed as P-31). Writing the response is the narrowest fix —
 * nothing is guessed, it is exactly what the server now holds.</p>
 */
export function useUpdateProjectReceipt(projectId: string) {
  const qc = useQueryClient();
  const invalidate = useProjectReceiptsWriter(projectId);
  return useMutation({
    mutationFn: ({ receiptId, req }: { receiptId: string; req: ProjectReceiptRequest }) =>
      projectReceiptsApi.update(projectId, receiptId, req),
    onSuccess: (saved) => {
      qc.setQueryData<ProjectReceiptResponse[]>(
        projectReceiptsKey(projectId),
        (old) => old?.map((r) => (r.id === saved.id ? saved : r)),
      );
      invalidate();
    },
  });
}

export function useDeleteProjectReceipt(projectId: string) {
  const qc = useQueryClient();
  const invalidate = useProjectReceiptsWriter(projectId);
  return useMutation({
    mutationFn: (receiptId: string) => projectReceiptsApi.remove(projectId, receiptId),
    onSuccess: (_void, receiptId) => {
      // Gone from the list at once: the row carries a photo, and a deleted receipt lingering for
      // the length of a refetch is the one state that reads as «it did not work, tap again».
      qc.setQueryData<ProjectReceiptResponse[]>(
        projectReceiptsKey(projectId),
        (old) => old?.filter((r) => r.id !== receiptId),
      );
      invalidate();
    },
  });
}
