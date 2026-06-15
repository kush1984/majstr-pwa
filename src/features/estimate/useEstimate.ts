import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { estimatesApi } from '@/api/estimates.ts';
import type {
  EstimateItemFromCatalogRequest,
  EstimateItemRequest,
  EstimateUpdateRequest,
} from '@/api/types.ts';

export const ESTIMATE_KEY = ['estimate'] as const;

export function useEstimate(id: string) {
  return useQuery({
    queryKey: [...ESTIMATE_KEY, id],
    queryFn: () => estimatesApi.get(id),
    enabled: Boolean(id),
  });
}

function useInvalidateEstimate(estimateId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: [...ESTIMATE_KEY, estimateId] });
    // project cards + dashboard show estimate-derived sums/status.
    qc.invalidateQueries({ queryKey: ['projects'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useAddItem(estimateId: string) {
  const invalidate = useInvalidateEstimate(estimateId);
  return useMutation({
    mutationFn: (req: EstimateItemRequest) => estimatesApi.addItem(estimateId, req),
    onSuccess: invalidate,
  });
}

export function useAddItemFromCatalog(estimateId: string) {
  const invalidate = useInvalidateEstimate(estimateId);
  return useMutation({
    mutationFn: (args: { catalogItemId: string; req: EstimateItemFromCatalogRequest }) =>
      estimatesApi.addItemFromCatalog(estimateId, args.catalogItemId, args.req),
    onSuccess: invalidate,
  });
}

export function useUpdateItem(estimateId: string) {
  const invalidate = useInvalidateEstimate(estimateId);
  return useMutation({
    mutationFn: (args: { itemId: string; req: EstimateItemRequest }) =>
      estimatesApi.updateItem(estimateId, args.itemId, args.req),
    onSuccess: invalidate,
  });
}

export function useRemoveItem(estimateId: string) {
  const invalidate = useInvalidateEstimate(estimateId);
  return useMutation({
    mutationFn: (itemId: string) => estimatesApi.removeItem(estimateId, itemId),
    onSuccess: invalidate,
  });
}

export function useUpdateEstimate(estimateId: string) {
  const invalidate = useInvalidateEstimate(estimateId);
  return useMutation({
    mutationFn: (req: EstimateUpdateRequest) => estimatesApi.update(estimateId, req),
    onSuccess: invalidate,
  });
}

/** Reopen a SIGNED estimate (owner) → DRAFT, signature cleared. */
export function useReopenEstimate(estimateId: string) {
  const invalidate = useInvalidateEstimate(estimateId);
  return useMutation({
    mutationFn: () => estimatesApi.reopen(estimateId),
    onSuccess: invalidate,
  });
}

/** Delete an estimate. Backend forbids deleting SIGNED (reopen first). */
export function useDeleteEstimate(estimateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => estimatesApi.remove(estimateId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['project-estimates'] });
    },
  });
}
