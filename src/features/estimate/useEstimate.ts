import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { estimatesApi } from '@/api/estimates.ts';
import { newUuid } from '@/lib/uuid.ts';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import type {
  BatchCatalogItemEntry,
  EstimateCreateRequest,
  EstimateItemFromCatalogRequest,
  EstimateItemRequest,
  EstimateItemResponse,
  EstimateResponse,
  EstimateSummary,
  EstimateUpdateRequest,
} from '@/api/types.ts';

export const ESTIMATE_KEY = ['estimate'] as const;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Recompute the estimate's derived totals after an optimistic item edit — the same arithmetic the
 * server does, so an offline estimate shows correct sums until it syncs (the server stays the
 * source of truth and re-derives on reconnect). Mirrors: lineTotal = qty·price; works/materials
 * subtotals by type; total = works + materials; balance = total − deposit (clamped).
 */
function recompute(est: EstimateResponse): EstimateResponse {
  const items = est.items.map((i) => ({ ...i, lineTotal: round2(i.quantity * i.unitPrice) }));
  const sum = (t: 'WORK' | 'MATERIAL') =>
    round2(items.filter((i) => i.type === t).reduce((s, i) => s + i.lineTotal, 0));
  const worksSubtotal = sum('WORK');
  const materialsSubtotal = sum('MATERIAL');
  const total = round2(worksSubtotal + materialsSubtotal);
  const balance = Math.max(0, round2(total - (est.depositAmount ?? 0)));
  return { ...est, items, worksSubtotal, materialsSubtotal, total, balance };
}

/** Apply a change to the cached estimate detail (if present) and re-derive totals. */
function patchEstimate(qc: QueryClient, estimateId: string, edit: (items: EstimateItemResponse[]) => EstimateItemResponse[]): void {
  qc.setQueryData<EstimateResponse>([...ESTIMATE_KEY, estimateId], (old) =>
    old ? recompute({ ...old, items: edit(old.items) }) : old);
}

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
    void qc.invalidateQueries({ queryKey: [...ESTIMATE_KEY, estimateId] });
    // The object screen's estimate list shows the NAME — without this a rename
    // stays stale until a manual refresh (the summaries live under their own key).
    void qc.invalidateQueries({ queryKey: ['project-estimates'] });
    // project cards + dashboard show estimate-derived sums/status.
    void qc.invalidateQueries({ queryKey: ['projects'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    // object economy is derived from estimate totals + deposits — refresh it too
    // (deposit or item edits must recompute contracted / received / cash live).
    void qc.invalidateQueries({ queryKey: ['object-economy'] });
  };
}

/**
 * Create an estimate on a project — offline-first. A client-generated UUID lets it open instantly
 * (empty, DRAFT) and the create ride the outbox (idempotent via the id header), depending on the
 * project so it never lands before the object exists. The FREE per-project estimate cap is gated
 * client-side (`isAtLimit` off the cached list) — that works offline too.
 */
export function useCreateEstimate() {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ projectId, req }: { projectId: string; req: EstimateCreateRequest }): Promise<EstimateResponse> => {
      const id = newUuid();
      const now = new Date().toISOString();
      const optimistic: EstimateResponse = {
        id, projectId, name: req.name ?? null, status: 'DRAFT',
        validUntil: req.validUntil ?? null, notes: req.notes ?? null,
        createdAt: now, updatedAt: now, items: [],
        worksSubtotal: 0, materialsSubtotal: 0, total: 0, depositAmount: null, balance: 0,
      };
      return offlineMutate<EstimateResponse>({
        entity: 'estimate', entityId: id, type: 'create',
        payload: { projectId, req }, deps: [projectId],
        online: () => estimatesApi.createForProject(projectId, req, id),
        onOnlineSuccess: () => {
          void qc.invalidateQueries({ queryKey: ['project-estimates', projectId] });
          void qc.invalidateQueries({ queryKey: ['projects'] });
        },
        optimistic: () => {
          qc.setQueryData<EstimateResponse>([...ESTIMATE_KEY, id], optimistic);
          const summary: EstimateSummary = {
            id, projectId, name: optimistic.name, status: 'DRAFT',
            validUntil: optimistic.validUntil, createdAt: now, updatedAt: now, countInEconomy: false,
          };
          qc.setQueryData<EstimateSummary[]>(['project-estimates', projectId], (old) => [summary, ...(old ?? [])]);
          return optimistic;
        },
      });
    },
  });
}

export function useAddItem(estimateId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateEstimate(estimateId);
  return useMutation({
    networkMode: 'always', // run offline (default 'online' pauses it) so offlineMutate can queue
    mutationFn: (req: EstimateItemRequest): Promise<EstimateItemResponse> => {
      const id = newUuid();
      return offlineMutate<EstimateItemResponse>({
        entity: 'estimateItem', entityId: id, type: 'create',
        payload: { estimateId, req }, deps: [estimateId],
        online: () => estimatesApi.addItem(estimateId, req, id),
        onOnlineSuccess: invalidate,
        optimistic: () => {
          const item: EstimateItemResponse = {
            id, type: req.type, name: req.name, category: req.category ?? null,
            unit: req.unit, quantity: req.quantity, unitPrice: req.unitPrice,
            lineTotal: round2(req.quantity * req.unitPrice),
            sortOrder: req.sortOrder ?? 0, measurementRefs: req.measurementRefs ?? [],
            quantityManual: req.quantityManual ?? false,
          };
          patchEstimate(qc, estimateId, (items) => [...items, item]);
          return item;
        },
      });
    },
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

/** Add several catalog items at once (multi-select picker) in one request. */
export function useAddItemsFromCatalogBatch(estimateId: string) {
  const invalidate = useInvalidateEstimate(estimateId);
  return useMutation({
    mutationFn: (items: BatchCatalogItemEntry[]) =>
      estimatesApi.addItemsFromCatalogBatch(estimateId, items),
    onSuccess: invalidate,
  });
}

export function useUpdateItem(estimateId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateEstimate(estimateId);
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ itemId, req }: { itemId: string; req: EstimateItemRequest }): Promise<void> => {
      return offlineMutate<void>({
        entity: 'estimateItem', entityId: itemId, type: 'update',
        payload: { estimateId, req }, deps: [estimateId],
        online: async () => { await estimatesApi.updateItem(estimateId, itemId, req); },
        onOnlineSuccess: invalidate,
        optimistic: () => {
          patchEstimate(qc, estimateId, (items) => items.map((i) => (i.id === itemId ? {
            ...i, type: req.type, name: req.name, category: req.category ?? null,
            unit: req.unit, quantity: req.quantity, unitPrice: req.unitPrice,
            measurementRefs: req.measurementRefs ?? i.measurementRefs,
            quantityManual: req.quantityManual ?? i.quantityManual,
          } : i)));
        },
      });
    },
  });
}

export function useRemoveItem(estimateId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateEstimate(estimateId);
  return useMutation({
    networkMode: 'always',
    mutationFn: (itemId: string): Promise<void> => {
      return offlineMutate<void>({
        entity: 'estimateItem', entityId: itemId, type: 'delete',
        payload: { estimateId }, deps: [estimateId],
        online: async () => { await estimatesApi.removeItem(estimateId, itemId); },
        onOnlineSuccess: invalidate,
        optimistic: () => {
          patchEstimate(qc, estimateId, (items) => items.filter((i) => i.id !== itemId));
        },
      });
    },
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
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['project-estimates'] });
    },
  });
}
