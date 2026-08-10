import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { catalogApi } from '@/api/catalog.ts';
import type { CatalogItemRequest, CatalogItemResponse, ItemType, Trade, UserResponse } from '@/api/types.ts';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import { newUuid } from '@/lib/uuid.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';

/** Look up a custom trade's CURRENT name from the cached profile, for an optimistic patch —
 *  the server is the source of truth and will overwrite this on the next fetch. */
function resolveCustomTradeName(
  qc: ReturnType<typeof useQueryClient>,
  customTradeId: string | null | undefined,
): string | null {
  if (!customTradeId) return null;
  const me = qc.getQueryData<UserResponse>(ME_QUERY_KEY);
  return me?.customTrades.find((ct) => ct.id === customTradeId)?.name ?? null;
}

export const CATALOG_KEY = ['catalog'] as const;

export function useCatalog(type?: ItemType) {
  return useQuery({
    queryKey: [...CATALOG_KEY, 'list', type ?? 'all'],
    queryFn: () => catalogApi.list(type),
  });
}

export function useCatalogCategories() {
  return useQuery({
    queryKey: [...CATALOG_KEY, 'categories'],
    queryFn: () => catalogApi.categories(),
  });
}

/**
 * Type-ahead search over the contractor's own catalog (add-item autocomplete).
 * Runs only once there's a term; `retry: false` so an as-yet-unimplemented
 * `/search` endpoint doesn't hammer the backend (the autocomplete component
 * falls back to client-side filtering on error). 60s staleTime since a catalog
 * changes rarely within a session.
 */
export function useCatalogSearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: [...CATALOG_KEY, 'search', term],
    queryFn: () => catalogApi.search(term),
    enabled: term.length >= 1,
    staleTime: 60_000,
    retry: false,
  });
}

function useInvalidateCatalog() {
  const qc = useQueryClient();
  return () => { void qc.invalidateQueries({ queryKey: CATALOG_KEY }); };
}

/**
 * Patch every cached catalog list (`all` plus the per-type ones) so an offline edit shows up
 * wherever the page is looking. `keep` filters which lists a created item belongs in.
 */
function patchCatalog(
  qc: ReturnType<typeof useQueryClient>,
  edit: (items: CatalogItemResponse[]) => CatalogItemResponse[],
  keep: (listType: string) => boolean = () => true,
): void {
  qc.getQueryCache()
    .findAll({ queryKey: [...CATALOG_KEY, 'list'] })
    .forEach((q) => {
      if (!keep(String(q.queryKey[2]))) return;
      qc.setQueryData<CatalogItemResponse[]>(q.queryKey, (old) => (old ? edit(old) : old));
    });
}

/**
 * Catalog CRUD — offline-first. A master often adds or re-prices a position right on site, so these
 * write optimistically and queue when there is no signal. The backend create is idempotent twice
 * over: by the client UUID, and by its own (name, type, unit) dedupe.
 */
export function useCreateCatalogItem() {
  const qc = useQueryClient();
  const invalidate = useInvalidateCatalog();
  return useMutation({
    networkMode: 'always',
    mutationFn: (req: CatalogItemRequest): Promise<CatalogItemResponse> => {
      const id = newUuid();
      const customTradeId = req.customTradeId ?? null;
      const optimistic: CatalogItemResponse = {
        id,
        name: req.name,
        category: req.category ?? null,
        trade: customTradeId ? 'OTHER' : (req.trade ?? null),
        customTradeId,
        customTradeName: resolveCustomTradeName(qc, customTradeId),
        type: req.type,
        unit: req.unit,
        defaultPrice: req.defaultPrice,
        // At the END, matching what the server does with a new position. A number bigger than any
        // real one rather than a guessed index: the optimistic row only has to sort last until the
        // server's own answer replaces it, and picking an index risks colliding with a real slot.
        sortOrder: Number.MAX_SAFE_INTEGER,
        createdAt: new Date().toISOString(),
        // Whether this brand-new position is also shipped under another trade is something only
        // the server (catalog_templates) knows — invalidate() replaces this with the real answer
        // as soon as the create round-trips.
        sharedTrades: [],
      };
      return offlineMutate<CatalogItemResponse>({
        entity: 'catalogItem', entityId: id, type: 'create', payload: req, deps: [],
        online: () => catalogApi.create(req, id),
        onOnlineSuccess: invalidate,
        optimistic: () => {
          // Only into lists this item belongs in: the "all" list and its own type's list.
          patchCatalog(qc, (items) => [...items, optimistic], (t) => t === 'all' || t === req.type);
          return optimistic;
        },
      });
    },
  });
}

export function useUpdateCatalogItem() {
  const qc = useQueryClient();
  const invalidate = useInvalidateCatalog();
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ id, req }: { id: string; req: CatalogItemRequest }): Promise<void> =>
      offlineMutate<void>({
        entity: 'catalogItem', entityId: id, type: 'update', payload: req, deps: [],
        online: async () => { await catalogApi.update(id, req); },
        onOnlineSuccess: invalidate,
        optimistic: () => {
          const customTradeId = req.customTradeId ?? null;
          patchCatalog(qc, (items) => items.map((i) => (i.id === id ? {
            ...i, name: req.name, category: req.category ?? null,
            trade: customTradeId ? 'OTHER' : (req.trade ?? i.trade),
            customTradeId,
            customTradeName: resolveCustomTradeName(qc, customTradeId),
            type: req.type, unit: req.unit, defaultPrice: req.defaultPrice,
          } : i)));
        },
      }),
  });
}

export function useDeleteCatalogItem() {
  const qc = useQueryClient();
  const invalidate = useInvalidateCatalog();
  return useMutation({
    networkMode: 'always',
    mutationFn: (id: string): Promise<void> =>
      offlineMutate<void>({
        entity: 'catalogItem', entityId: id, type: 'delete', payload: {}, deps: [],
        online: async () => { await catalogApi.remove(id); },
        onOnlineSuccess: invalidate,
        optimistic: () => patchCatalog(qc, (items) => items.filter((i) => i.id !== id)),
      }),
  });
}

/**
 * Delete several positions at once.
 *
 * <p>Queued through the outbox as ONE operation rather than N single deletes, and that is not just
 * tidiness: replayed one by one, a 200-position clear-out is 200 requests that can half-succeed and
 * leave the master looking at a list nobody chose. One operation either lands or does not.</p>
 */
export function useDeleteCatalogItems() {
  const qc = useQueryClient();
  const invalidate = useInvalidateCatalog();
  return useMutation({
    networkMode: 'always',
    mutationFn: (ids: string[]): Promise<void> =>
      offlineMutate<void>({
        // Keyed on the first id: the outbox needs a stable entity id, and a bulk delete is not
        // something a later edit of one of these rows can meaningfully depend on — they are gone.
        entity: 'catalogItem', entityId: ids[0], type: 'delete', payload: { ids }, deps: [],
        online: async () => { await catalogApi.deleteItems(ids); },
        onOnlineSuccess: invalidate,
        optimistic: () => {
          const gone = new Set(ids);
          patchCatalog(qc, (items) => items.filter((i) => !gone.has(i.id)));
        },
      }),
  });
}

export function useResetCatalog() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: () => catalogApi.resetFromTemplate(),
    onSuccess: invalidate,
  });
}

/** Merge the starter set for the given trades into the catalog (no overwrite,
 *  no duplicates). Used after a trade is added to the profile. */
export function useAddCatalogTemplates() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (trades: Trade[]) => catalogApi.addFromTemplate(trades),
    onSuccess: invalidate,
  });
}

/** How many NEW default items are available to add (drives the "Add new from
 *  library" button's confirm dialog). Fetched on demand (the button triggers
 *  the check), so it's a mutation rather than an always-on query. */
export function useCheckTemplateUpdates() {
  return useMutation({
    mutationFn: () => catalogApi.templateUpdates(),
  });
}

/** Add the NEW default items for the user's trades (merge — never overwrites
 *  prices or duplicates, never re-adds deleted items). */
export function useAddNewFromTemplate() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: () => catalogApi.addNewFromTemplate(),
    onSuccess: invalidate,
  });
}
