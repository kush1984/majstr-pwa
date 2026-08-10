import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { estimatesApi } from '@/api/estimates.ts';
import { newUuid } from '@/lib/uuid.ts';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import { CATALOG_KEY } from '@/features/catalog/useCatalog.ts';
import type {
  BatchCatalogItemEntry,
  CatalogItemResponse,
  EstimateCreateRequest,
  EstimateDuplicateRequest,
  EstimateItemFromCatalogRequest,
  EstimateItemRequest,
  EstimateItemResponse,
  EstimateItemsOrderRequest,
  EstimateResponse,
  EstimateSummary,
  EstimateUpdateRequest,
} from '@/api/types.ts';

export const ESTIMATE_KEY = ['estimate'] as const;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The three-step pass, mirroring the server's EstimateMath — <b>change the two together</b>.
 *
 * <p>«%» is a share OF something, which turns a flat list of independent multiplications into a
 * small dependency graph. The order below is the design, not an implementation detail:</p>
 *   1. ordinary lines — quantity × price;
 *   2. percentages of a LINE or of a hand-typed sum;
 *   3. percentages of the ESTIMATE («% від кошторису»), each against the subtotal of ITS OWN type
 *      (works or materials) — the split the master sees on the summary card.
 *
 * <p>A percent of a percent is impossible by construction, so there is no graph to walk and no
 * cycle to detect. Every «% від кошторису» of one type shares that type's base — compounding them
 * would make the answer depend on which was entered first. Such a line may be signed: a minus is a
 * discount off that subtotal.</p>
 *
 * <p>This computes for DISPLAY only. `lineTotal` is written by the server and never sent back;
 * offline the master sees the right numbers until the sync re-derives them.</p>
 */
function recomputeLines(source: EstimateItemResponse[]): EstimateItemResponse[] {
  const items = source.map((i) => ({ ...i }));
  const amountById = new Map<string, number>();

  for (const i of items) {
    if (i.unit !== 'PERCENT') {
      i.lineTotal = round2(i.quantity * i.unitPrice);
      amountById.set(i.id, i.lineTotal);
    }
  }

  const kindOf = (i: EstimateItemResponse) => i.percentBaseKind ?? 'MANUAL';
  const share = (i: EstimateItemResponse, base: number | null) =>
    // A missing base keeps the last computed amount: the master is charging for this line, and
    // zeroing it because its base was deleted would be data loss dressed up as tidiness.
    base == null ? i.lineTotal : round2((base * i.quantity) / 100);

  for (const i of items) {
    if (i.unit !== 'PERCENT' || kindOf(i) === 'TOTAL') continue;
    const base = i.baseDetached
      ? null
      : kindOf(i) === 'MANUAL'
        ? i.unitPrice
        : (i.percentBaseItemId != null ? amountById.get(i.percentBaseItemId) ?? null : null);
    i.lineTotal = share(i, base);
  }

  const baseOfType = (type: 'WORK' | 'MATERIAL') =>
    round2(items
      .filter((i) => !(i.unit === 'PERCENT' && kindOf(i) === 'TOTAL') && i.type === type)
      .reduce((s, i) => s + i.lineTotal, 0));
  const worksBase = baseOfType('WORK');
  const materialsBase = baseOfType('MATERIAL');
  for (const i of items) {
    if (i.unit === 'PERCENT' && kindOf(i) === 'TOTAL') {
      const base = i.baseDetached ? null : (i.type === 'WORK' ? worksBase : materialsBase);
      i.lineTotal = share(i, base);
    }
  }
  return items;
}

/**
 * Recompute the estimate's derived totals after an optimistic item edit — the same arithmetic the
 * server does, so an offline estimate shows correct sums until it syncs (the server stays the
 * source of truth and re-derives on reconnect). Mirrors: line amounts via {@link recomputeLines};
 * works/materials subtotals by type; total = works + materials; balance = total − deposit (clamped).
 */
function recompute(est: EstimateResponse): EstimateResponse {
  const items = recomputeLines(est.items);
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
            // Carried through so the optimistic row is computed by the same rules the server uses;
            // the real amount arrives with the reply and replaces this one.
            percentBaseKind: req.percentBaseKind ?? null,
            percentBaseItemId: req.percentBaseItemId ?? null,
            baseDetached: false,
            baseOriginLabel: null,
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
        // A new line is never a percentage: «%» is chosen in the editor, where a base is chosen too.
        percentBaseKind: null, percentBaseItemId: null, baseDetached: false, baseOriginLabel: null,
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

/**
 * Persist the arrangement a drag produced: the caller passes the lines in their new order, each
 * already carrying the category (section) it now belongs to, and this states that whole arrangement
 * to the server.
 *
 * `coalesce` because dragging four times offline means the master wants the fourth arrangement —
 * every request overwrites the whole order anyway, so replaying the abandoned three would only cost
 * round trips to reach where the last one already points.
 */
export function useReorderItems(estimateId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateEstimate(estimateId);
  return useMutation({
    networkMode: 'always',
    mutationFn: (arranged: EstimateItemResponse[]): Promise<void> => {
      const req: EstimateItemsOrderRequest = {
        items: arranged.map((i) => ({ id: i.id, category: i.category })),
      };
      return offlineMutate<void>({
        entity: 'estimateItemOrder', entityId: estimateId, type: 'update',
        payload: { req }, deps: [estimateId], coalesce: true,
        online: async () => { await estimatesApi.reorderItems(estimateId, req); },
        onOnlineSuccess: invalidate,
        // sortOrder is renumbered from the position so the cached estimate re-groups into the same
        // sections the master just dragged — grouping reads sortOrder, not the array order.
        optimistic: () => {
          patchEstimate(qc, estimateId, () => arranged.map((i, idx) => ({ ...i, sortOrder: idx })));
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
 * Delete several lines at once — the answer to «створив зі шаблону 167 позицій, треба 37 видалити».
 *
 * ONE outbox op for the whole selection, not one per line: the master watched the trim finish on
 * screen, and a replay that stops half-way would leave him an estimate he has already stopped
 * checking. Offline-capable — trimming a template down is exactly what happens on site.
 */
export function useDeleteItems(estimateId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateEstimate(estimateId);
  return useMutation({
    networkMode: 'always',
    mutationFn: (itemIds: string[]): Promise<void> => {
      return offlineMutate<void>({
        entity: 'estimateItemsBulkDelete', entityId: estimateId, type: 'delete',
        payload: { itemIds }, deps: [estimateId],
        online: async () => { await estimatesApi.deleteItems(estimateId, itemIds); },
        onOnlineSuccess: invalidate,
        optimistic: () => {
          const gone = new Set(itemIds);
          patchEstimate(qc, estimateId, (items) => items.filter((i) => !gone.has(i.id)));
        },
      });
    },
  });
}

/**
 * Copy this estimate with a markup on the chosen lines — the foreman's crew price vs client price.
 *
 * <b>Online only, and that is a money decision rather than a shortcut.</b> Composing it on the
 * device would have to create the copy through the ordinary "new estimate + N lines" path, and
 * that path carries no `sourceUnitPrice`. The estimate would look perfectly right while the object
 * economy silently counted the whole client total as earnings instead of just the markup. A clear
 * "потрібен інтернет" beats quietly wrong money.
 */
export function useDuplicateEstimate(estimateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: EstimateDuplicateRequest) => estimatesApi.duplicate(estimateId, req),
    onSuccess: (created) => {
      // Both estimates changed: the copy is new, and the source just stopped counting in the
      // economy, which the object screen shows.
      void qc.invalidateQueries({ queryKey: ['project-estimates', created.projectId] });
      void qc.invalidateQueries({ queryKey: ['economy', created.projectId] });
      void qc.invalidateQueries({ queryKey: [...ESTIMATE_KEY, estimateId] });
    },
  });
}

/**
 * Edit the estimate's own fields — status, name, valid-until, notes. Money moved to
 * `project_payment` (payments-economy-portal iteration) — no deposit field here anymore.
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
            old ? { ...old, ...req } : old);
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
