import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { estimatesApi } from '@/api/estimates.ts';
import { newUuid } from '@/lib/uuid.ts';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import { CATALOG_KEY } from '@/features/catalog/useCatalog.ts';
import type {
  BatchCatalogItemEntry,
  CatalogItemResponse,
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

/**
 * The FULL set of screens an estimate change affects. Exported so every writer uses the
 * same one: the receipt import used to invalidate only the estimate itself, so appending a
 * ₴5 000 receipt left the object list, the dashboard and the economy showing the old total
 * until they happened to refetch.
 */
export function useInvalidateEstimate(estimateId: string) {
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

/**
 * Add a line copied from a catalog position — offline-capable.
 *
 * Picking from the catalog is how estimates actually get built; typing every line by hand on
 * a phone is not a real alternative, so "make estimates offline" was only half true while this
 * needed a signal. It replays through the from-catalog endpoint rather than the plain item add,
 * because a catalog position may legally cost 0 while the validated add form demands ≥ 0.01 —
 * routing through it would queue such lines happily and reject them on replay.
 */
export function useAddItemFromCatalog(estimateId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateEstimate(estimateId);
  return useMutation({
    networkMode: 'always',
    mutationFn: (args: { catalogItemId: string; req: EstimateItemFromCatalogRequest }) => {
      const id = newUuid();
      return offlineMutate<void>({
        entity: 'estimateItemFromCatalog', entityId: id, type: 'create',
        payload: { estimateId, catalogItemId: args.catalogItemId, req: args.req },
        deps: [estimateId],
        online: async () => {
          await estimatesApi.addItemFromCatalog(estimateId, args.catalogItemId, args.req, id);
        },
        onOnlineSuccess: invalidate,
        optimistic: () => patchEstimateWithCatalogLines(qc, estimateId, [
          { id, catalogItemId: args.catalogItemId, quantity: args.req.quantity, sortOrder: args.req.sortOrder },
        ]),
      });
    },
  });
}

/**
 * Add several catalog positions at once (multi-select picker).
 *
 * Stays ONE outbox op carrying the whole selection, not N — so online it is still a single
 * round trip, and offline the master's "add these six" replays as one unit. Each entry carries
 * its own client id, so a partially-applied batch resumes per line instead of duplicating
 * everything that already landed.
 */
export function useAddItemsFromCatalogBatch(estimateId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateEstimate(estimateId);
  return useMutation({
    networkMode: 'always',
    mutationFn: (items: BatchCatalogItemEntry[]) => {
      const withIds = items.map((e) => ({ ...e, id: e.id ?? newUuid() }));
      return offlineMutate<void>({
        entity: 'estimateItemsFromCatalogBatch', entityId: withIds[0].id, type: 'create',
        payload: { estimateId, items: withIds },
        deps: [estimateId],
        online: async () => { await estimatesApi.addItemsFromCatalogBatch(estimateId, withIds); },
        onOnlineSuccess: invalidate,
        optimistic: () => patchEstimateWithCatalogLines(qc, estimateId, withIds),
      });
    },
  });
}

/**
 * Optimistically append catalog lines to the cached estimate.
 *
 * The name/unit/type/price are resolved from the CACHED catalog — the same copy the server
 * performs — so the master sees real lines offline rather than placeholders. The server still
 * does the authoritative copy on replay; if the cached catalog were stale, its version wins.
 */
function patchEstimateWithCatalogLines(
  qc: QueryClient,
  estimateId: string,
  entries: { id: string; catalogItemId: string; quantity: number; sortOrder?: number }[],
): void {
  const catalog = qc.getQueryData<CatalogItemResponse[]>([...CATALOG_KEY, 'list', 'all']) ?? [];
  patchEstimate(qc, estimateId, (items) => {
    const lines = entries.flatMap<EstimateItemResponse>((e) => {
      const src = catalog.find((c) => c.id === e.catalogItemId);
      // Not in the cached catalog (never prefetched, or added on another device) — skip the
      // preview rather than invent a line; the server still adds it correctly on replay.
      if (!src) return [];
      return [{
        id: e.id,
        type: src.type,
        name: src.name,
        category: src.category,
        unit: src.unit,
        quantity: e.quantity,
        unitPrice: src.defaultPrice,
        lineTotal: 0, // patchEstimate re-derives every lineTotal and the subtotals
        sortOrder: e.sortOrder ?? 0,
        measurementRefs: [],
        quantityManual: false,
      }];
    });
    return [...items, ...lines];
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

/**
 * Edit the estimate's own fields — status, name, valid-until, notes, deposit.
 *
 * Offline-capable: marking an estimate «Надіслано» or naming a variant on site is core work,
 * and it used to go straight to the network and fail. `SIGNED` never reaches here from the UI
 * (the server rejects it — a signature may only come from the portal), so a queued status
 * change is always one the server will accept.
 */
export function useUpdateEstimate(estimateId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateEstimate(estimateId);
  return useMutation({
    networkMode: 'always', // run offline (the default 'online' PAUSES) so offlineMutate can queue
    mutationFn: (req: EstimateUpdateRequest) =>
      offlineMutate<void>({
        entity: 'estimate', entityId: estimateId, type: 'update', payload: { req },
        deps: [],
        online: async () => { await estimatesApi.update(estimateId, req); },
        onOnlineSuccess: invalidate,
        optimistic: () => {
          qc.setQueryData<EstimateResponse>([...ESTIMATE_KEY, estimateId], (old) =>
            old ? { ...old, ...req, depositAmount: req.depositAmount ?? old.depositAmount } : old);
          // The object's estimate list shows status + name on each card.
          qc.setQueriesData<EstimateSummary[]>({ queryKey: ['project-estimates'] }, (old) =>
            (old ?? []).map((e) => (e.id === estimateId ? { ...e, status: req.status, name: req.name ?? e.name } : e)));
        },
      }),
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

/**
 * Delete an estimate. Backend forbids deleting SIGNED (reopen first) and is idempotent, so a
 * replayed delete of an already-gone estimate succeeds instead of blocking the queue.
 *
 * Offline-capable — and not merely for convenience: the FREE cap tells a master who is over
 * the limit to delete something, and while this went straight to the network that instruction
 * was impossible to follow without a signal.
 */
export function useDeleteEstimate(estimateId: string) {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: () =>
      offlineMutate<void>({
        entity: 'estimate', entityId: estimateId, type: 'delete', payload: {},
        deps: [],
        online: async () => { await estimatesApi.remove(estimateId); },
        onOnlineSuccess: () => {
          void qc.invalidateQueries({ queryKey: ['projects'] });
          void qc.invalidateQueries({ queryKey: ['dashboard'] });
          void qc.invalidateQueries({ queryKey: ['project-estimates'] });
        },
        optimistic: () => {
          qc.setQueriesData<EstimateSummary[]>({ queryKey: ['project-estimates'] }, (old) =>
            (old ?? []).filter((e) => e.id !== estimateId));
          qc.removeQueries({ queryKey: [...ESTIMATE_KEY, estimateId] });
        },
      }),
  });
}
