import {
  onlineManager, useMutation, useQuery, useQueryClient, type QueryClient,
} from '@tanstack/react-query';
import { estimateTemplatesApi } from '@/api/estimateTemplates.ts';
import type {
  CatalogItemResponse,
  EstimateCreateRequest,
  EstimateItemRequest,
  EstimateItemResponse,
  EstimateResponse,
  EstimateSummary,
  EstimateTemplateDetail,
  EstimateTemplateItemView,
  EstimateTemplateSummary,
  TemplateItemRequest,
  TemplateItemsOrderRequest,
  Trade,
} from '@/api/types.ts';
import { isNetworkError, offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import { enqueue } from '@/lib/outbox/outbox.ts';
import { newUuid } from '@/lib/uuid.ts';
import { CATALOG_KEY } from '@/features/catalog/useCatalog.ts';
import { ESTIMATE_KEY } from '@/features/estimate/useEstimate.ts';

export const ESTIMATE_TEMPLATE_KEY = ['estimate-templates'] as const;

/** Defaults relevant to my trades (+ general) plus my own templates. */
export function useEstimateTemplates() {
  return useQuery({
    queryKey: ESTIMATE_TEMPLATE_KEY,
    queryFn: () => estimateTemplatesApi.list(),
  });
}

/** A template's composition (its positions) — for the preview. Lazy: only
 *  fetched once a template is opened. */
export function useEstimateTemplate(id: string | null) {
  return useQuery({
    queryKey: [...ESTIMATE_TEMPLATE_KEY, id],
    queryFn: () => estimateTemplatesApi.get(id as string),
    enabled: Boolean(id),
  });
}

function useInvalidateTemplates() {
  const qc = useQueryClient();
  return () => { void qc.invalidateQueries({ queryKey: ESTIMATE_TEMPLATE_KEY }); };
}

/** Save the current estimate as my own reusable template. */
export function useSaveAsTemplate(estimateId: string) {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: (req: { name: string; trade: Trade | null; customTradeId?: string | null }) =>
      estimateTemplatesApi.saveFromEstimate(estimateId, req),
    onSuccess: invalidate,
  });
}

/** Patch one template's row in the cached list (no-op when the list isn't cached yet). */
function patchSummary(
  qc: QueryClient,
  id: string,
  edit: (t: EstimateTemplateSummary) => EstimateTemplateSummary,
): void {
  qc.setQueryData<EstimateTemplateSummary[]>(ESTIMATE_TEMPLATE_KEY, (old) =>
    old?.map((t) => (t.id === id ? edit(t) : t)));
}

function patchDetail(
  qc: QueryClient,
  id: string,
  edit: (d: EstimateTemplateDetail) => EstimateTemplateDetail,
): EstimateTemplateDetail | undefined {
  const key = [...ESTIMATE_TEMPLATE_KEY, id];
  const next = qc.getQueryData<EstimateTemplateDetail>(key);
  if (!next) return undefined;
  const patched = edit(next);
  qc.setQueryData(key, patched);
  return patched;
}

/**
 * Land a write's answer in the cache, FOLLOWING A FORK.
 *
 * A write on a system default answers with the master's own copy, whose id differs from the one we
 * asked for. Keying that answer under the id we sent would park the edits on a template that is no
 * longer in the list, and the next refetch of it would return the pristine default — the edits
 * would look like they vanished. So the detail is stored under the id the SERVER named, and the
 * one we asked for is dropped.
 *
 * Offline there is no fork yet (the copy is minted on replay) and `detail` is the optimistic one,
 * still keyed by the id we sent — which is exactly right until the queue drains.
 */
function adoptDetail(
  qc: QueryClient,
  requestedId: string,
  detail: EstimateTemplateDetail | undefined,
): void {
  if (!detail) return;
  qc.setQueryData([...ESTIMATE_TEMPLATE_KEY, detail.id], detail);
  if (detail.id !== requestedId) {
    qc.removeQueries({ queryKey: [...ESTIMATE_TEMPLATE_KEY, requestedId] });
  }
}

/**
 * Template editing is offline-first: the master reworks their own templates between objects,
 * often with no signal. `saveAsTemplate` / `applyTemplate` stay online — they read or write
 * server-side state (an estimate's items, a new estimate) we can't reproduce locally.
 */

/** Re-file a template into another trade (master's own setting). `customTradeId`/
 *  `customTradeName` only take effect on the caller's OWN template — a system default
 *  is re-filed through the per-master override, which has no place for a custom trade. */
export function useSetTemplateTrade() {
  const qc = useQueryClient();
  const invalidate = useInvalidateTemplates();
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ id, trade, customTradeId, customTradeName }: {
      id: string; trade: Trade | null; customTradeId?: string | null; customTradeName?: string | null;
    }): Promise<void> =>
      offlineMutate<void>({
        entity: 'estimateTemplate', entityId: id, type: 'update',
        payload: { op: 'trade', trade, customTradeId }, deps: [],
        online: async () => { await estimateTemplatesApi.setTrade(id, { trade, customTradeId }); },
        onOnlineSuccess: invalidate,
        optimistic: () => {
          const effectiveTrade = customTradeId ? 'OTHER' : trade;
          patchSummary(qc, id, (t) => ({
            ...t, trade: effectiveTrade,
            customTradeId: customTradeId ?? null, customTradeName: customTradeName ?? null,
          }));
          patchDetail(qc, id, (d) => ({
            ...d, trade: effectiveTrade,
            customTradeId: customTradeId ?? null, customTradeName: customTradeName ?? null,
          }));
        },
      }),
  });
}

/** Rename a template. Returns the server's row so the caller can follow a FORK — renaming a
 *  system default answers with the master's own copy, under a different id. */
export function useRenameTemplate() {
  const qc = useQueryClient();
  const invalidate = useInvalidateTemplates();
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ id, name }: { id: string; name: string }): Promise<EstimateTemplateSummary | undefined> =>
      offlineMutate<EstimateTemplateSummary | undefined>({
        entity: 'estimateTemplate', entityId: id, type: 'update', payload: { op: 'rename', name }, deps: [],
        online: () => estimateTemplatesApi.rename(id, { name }),
        onOnlineSuccess: invalidate,
        optimistic: () => {
          patchSummary(qc, id, (t) => ({ ...t, name }));
          patchDetail(qc, id, (d) => ({ ...d, name }));
          return undefined;
        },
      }),
  });
}

/** Delete a template. My own really goes; a SYSTEM DEFAULT is shared by every master, so the
 *  server hides it for me alone — either way it leaves MY list, which is what the row does here. */
export function useDeleteTemplate() {
  const qc = useQueryClient();
  const invalidate = useInvalidateTemplates();
  return useMutation({
    networkMode: 'always',
    mutationFn: (id: string): Promise<void> =>
      offlineMutate<void>({
        entity: 'estimateTemplate', entityId: id, type: 'delete', payload: {}, deps: [],
        online: async () => { await estimateTemplatesApi.remove(id); },
        onOnlineSuccess: invalidate,
        optimistic: () => {
          qc.setQueryData<EstimateTemplateSummary[]>(ESTIMATE_TEMPLATE_KEY, (old) =>
            old?.filter((t) => t.id !== id));
          void qc.removeQueries({ queryKey: [...ESTIMATE_TEMPLATE_KEY, id] });
        },
      }),
  });
}

/** Add a position to my own template. Returns the updated detail; we prime the
 *  detail cache and refresh the list (item counts changed). */
export function useAddTemplateItem(templateId: string) {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: (req: TemplateItemRequest): Promise<EstimateTemplateDetail | undefined> => {
      const id = newUuid();
      return offlineMutate<EstimateTemplateDetail | undefined>({
        entity: 'templateItem', entityId: id, type: 'create',
        payload: { templateId, req }, deps: [templateId],
        online: () => estimateTemplatesApi.addItem(templateId, req, id),
        onOnlineSuccess: () => { void qc.invalidateQueries({ queryKey: ESTIMATE_TEMPLATE_KEY }); },
        optimistic: () => {
          patchSummary(qc, templateId, (t) => ({ ...t, itemCount: t.itemCount + 1 }));
          return patchDetail(qc, templateId, (d) => ({
            ...d,
            items: [...d.items, {
              id, name: req.name, type: req.type, unit: req.unit,
              sortOrder: d.items.length ? d.items[d.items.length - 1].sortOrder + 1 : 0,
            }],
          }));
        },
      });
    },
    onSuccess: (detail) => adoptDetail(qc, templateId, detail),
  });
}

/** Remove a position from my own template. */
export function useRemoveTemplateItem(templateId: string) {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: (itemId: string): Promise<EstimateTemplateDetail | undefined> =>
      offlineMutate<EstimateTemplateDetail | undefined>({
        entity: 'templateItem', entityId: itemId, type: 'delete',
        payload: { templateId }, deps: [templateId],
        online: () => estimateTemplatesApi.removeItem(templateId, itemId),
        onOnlineSuccess: () => { void qc.invalidateQueries({ queryKey: ESTIMATE_TEMPLATE_KEY }); },
        optimistic: () => {
          patchSummary(qc, templateId, (t) => ({ ...t, itemCount: Math.max(0, t.itemCount - 1) }));
          return patchDetail(qc, templateId, (d) => ({
            ...d, items: d.items.filter((i) => i.id !== itemId),
          }));
        },
      }),
    onSuccess: (detail) => adoptDetail(qc, templateId, detail),
  });
}


/**
 * Edit a position in place — name / type / unit. The same write whether the master retyped it by
 * hand or picked a replacement out of the catalog; the catalog is only where the three values came
 * from (a template position carries no price, so nothing else crosses over).
 */
export function useUpdateTemplateItem(templateId: string) {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ itemId, req }: { itemId: string; req: TemplateItemRequest }):
    Promise<EstimateTemplateDetail | undefined> =>
      offlineMutate<EstimateTemplateDetail | undefined>({
        entity: 'templateItem', entityId: itemId, type: 'update',
        payload: { templateId, req }, deps: [templateId],
        online: () => estimateTemplatesApi.updateItem(templateId, itemId, req),
        onOnlineSuccess: () => { void qc.invalidateQueries({ queryKey: ESTIMATE_TEMPLATE_KEY }); },
        optimistic: () => patchDetail(qc, templateId, (d) => ({
          ...d, items: d.items.map((i) => (i.id === itemId ? { ...i, ...req } : i)),
        })),
      }),
    onSuccess: (detail) => adoptDetail(qc, templateId, detail),
  });
}

/**
 * Persist the arrangement a drag produced. A bundle is a SEQUENCE — what is done after what — so
 * this is real content, not decoration, which is why it is saved the moment the drag ends.
 *
 * `coalesce` because dragging four times offline means the master wants the fourth arrangement:
 * the request states the whole order anyway, so replaying the abandoned three would only cost
 * round trips to reach where the last one already points.
 */
export function useReorderTemplateItems(templateId: string) {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: (arranged: EstimateTemplateItemView[]): Promise<EstimateTemplateDetail | undefined> => {
      const req: TemplateItemsOrderRequest = { itemIds: arranged.map((i) => i.id) };
      return offlineMutate<EstimateTemplateDetail | undefined>({
        entity: 'templateItemOrder', entityId: templateId, type: 'update',
        payload: { req }, deps: [templateId], coalesce: true,
        online: () => estimateTemplatesApi.reorderItems(templateId, req),
        onOnlineSuccess: () => { void qc.invalidateQueries({ queryKey: ESTIMATE_TEMPLATE_KEY }); },
        optimistic: () => patchDetail(qc, templateId, (d) => ({
          ...d, items: arranged.map((i, idx) => ({ ...i, sortOrder: idx })),
        })),
      });
    },
    onSuccess: (detail) => adoptDetail(qc, templateId, detail),
  });
}

/**
 * Bring back every system default this master hid. Online-only on purpose: which defaults are
 * hidden is not something the device knows (the list simply omits them), so there is no honest
 * optimistic state to show — and it is a rare escape hatch, not a daily flow.
 */
export function useRestoreDefaults() {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: () => estimateTemplatesApi.restoreDefaults(),
    onSuccess: (list) => {
      qc.setQueryData(ESTIMATE_TEMPLATE_KEY, list);
      void qc.invalidateQueries({ queryKey: ESTIMATE_TEMPLATE_KEY });
    },
  });
}

/** Apply a template → a new estimate in the project. Invalidates the project's
 *  estimate list / cards (a new estimate appeared). */
/** Raised when a template can't be applied offline because its composition was never cached. */
export class TemplateNotCachedError extends Error {
  constructor() {
    super('offline.templateNotCached');
    this.name = 'TemplateNotCachedError';
  }
}

/**
 * Apply a template to an object, offline-first.
 *
 * Online this stays ONE request — the server owns the price substitution. Offline it is composed
 * on the device instead, because applying a template needs nothing the server alone can do: it is
 * a create plus N item creates, and both inputs are already in the offline cache (the template's
 * composition and the master's catalog). So rather than telling a master standing in a basement
 * "потрібен інтернет", we replay the server's own rule locally:
 *
 *   for each template position, match the master's catalog by LOWERCASED NAME (first wins) and
 *   take type/category/unit/price from the catalog entry; with no match keep the template's own
 *   type/unit at price 0. Quantity is always 0 — the master fills it in on site.
 *
 * The estimate and its lines ride the existing `estimate` / `estimateItem` handlers, so replay is
 * dependency-ordered and idempotent via the client UUIDs — no new endpoint, no backend change.
 *
 * Two honest consequences: prices come from the CACHED catalog, so they can differ from what the
 * server would have picked if the catalog changed since the last sync (the master reviews every
 * line anyway — quantities start empty); and the FREE estimate cap can only be enforced on replay,
 * where a rejection lands in the sync sheet as a "PRO or delete" decision.
 */
export function useApplyTemplate() {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always', // never let it sit paused offline — we have a real offline path
    mutationFn: async (
      args: { projectId: string; templateIds: string[]; req: EstimateCreateRequest },
    ): Promise<EstimateResponse> => {
      if (onlineManager.isOnline()) {
        try {
          const created = await estimateTemplatesApi.applyToProject(
            args.projectId, args.templateIds, args.req);
          void qc.invalidateQueries({ queryKey: ['projects'] });
          void qc.invalidateQueries({ queryKey: ['dashboard'] });
          return created;
        } catch (e) {
          if (!isNetworkError(e)) throw e; // real error → surface; blip → compose below
        }
      }
      return applyTemplateOffline(qc, args);
    },
  });
}

/** The offline half of {@link useApplyTemplate}: compose locally, then queue create + N lines. */
async function applyTemplateOffline(
  qc: QueryClient,
  { projectId, templateIds, req }: { projectId: string; templateIds: string[]; req: EstimateCreateRequest },
): Promise<EstimateResponse> {
  const templates = templateIds.map((id) =>
    qc.getQueryData<EstimateTemplateDetail>([...ESTIMATE_TEMPLATE_KEY, id]));
  if (templates.some((tpl) => !tpl)) {
    // Refuse loudly rather than create an EMPTY estimate the master would think is the template.
    // One missing bundle out of several is still a refusal: silently applying the rest would
    // produce an estimate that is short a section and looks complete.
    throw new TemplateNotCachedError();
  }
  const catalog = qc.getQueryData<CatalogItemResponse[]>([...CATALOG_KEY, 'list', 'all']) ?? [];
  const byName = new Map<string, CatalogItemResponse>();
  for (const c of catalog) {
    const key = c.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, c); // first wins — same as the server's merge
  }

  const estimateId = newUuid();
  const now = new Date().toISOString();

  // The lines, mirroring the server's substitution AND its de-duplication: bundles overlap, and
  // a position contributed by an earlier one must not come back from a later one. Same key as the
  // catalog lookup right above, so a line that resolves to one catalog row appears once.
  // sortOrder is renumbered across the whole result — each template counts its own from 0.
  const seen = new Set<string>();
  const lines = templates.flatMap((tpl) => tpl!.items ?? [])
    .filter((ti) => {
      const key = ti.name.trim().toLowerCase();
      return seen.has(key) ? false : (seen.add(key), true);
    })
    .map((ti, index) => {
      const match = byName.get(ti.name.toLowerCase());
      const request: EstimateItemRequest = {
        type: match?.type ?? ti.type,
        name: ti.name,
        category: match?.category ?? undefined,
        unit: match?.unit ?? ti.unit,
        quantity: 0, // empty — filled per object
        unitPrice: match?.defaultPrice ?? 0,
        sortOrder: index,
      };
      return { id: newUuid(), request };
    });

  // Queue the estimate first, then its lines depending on it: the engine replays in `seq` order
  // and holds a child until its parent has landed, so the server never sees an orphan line.
  await enqueue({
    entityId: estimateId, entity: 'estimate', type: 'create',
    payload: { projectId, req }, deps: [projectId],
  });
  for (const line of lines) {
    await enqueue({
      entityId: line.id, entity: 'estimateItem', type: 'create',
      payload: { estimateId, req: line.request }, deps: [estimateId],
    });
  }

  // Optimistic cache, so the estimate opens filled in immediately.
  const items: EstimateItemResponse[] = lines.map(({ id, request }) => ({
    id, type: request.type, name: request.name, category: request.category ?? null,
    unit: request.unit, quantity: 0, unitPrice: request.unitPrice,
    lineTotal: 0, sortOrder: request.sortOrder ?? 0, measurementRefs: [], quantityManual: false,
        // A new line is never a percentage: «%» is chosen in the editor, where a base is chosen too.
        percentBaseKind: null, percentBaseItemId: null, baseDetached: false, baseOriginLabel: null, closedByActs: null,
  }));
  const optimistic: EstimateResponse = {
    id: estimateId, projectId, name: req.name ?? null, status: 'DRAFT',
    validUntil: req.validUntil ?? null, notes: req.notes ?? null,
    createdAt: now, updatedAt: now, items,
    // Every quantity is 0, so every total is 0 — no rounding to worry about.
    worksSubtotal: 0, materialsSubtotal: 0, total: 0, depositAmount: null, balance: 0,
  };
  qc.setQueryData<EstimateResponse>([...ESTIMATE_KEY, estimateId], optimistic);
  const summary: EstimateSummary = {
    id: estimateId, projectId, name: optimistic.name, status: 'DRAFT',
    validUntil: optimistic.validUntil, createdAt: now, updatedAt: now, countInEconomy: false,
  };
  qc.setQueryData<EstimateSummary[]>(['project-estimates', projectId],
    (old) => [summary, ...(old ?? [])]);
  return optimistic;
}
