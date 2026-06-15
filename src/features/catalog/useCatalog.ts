import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { catalogApi } from '@/api/catalog.ts';
import type { CatalogItemRequest, ItemType } from '@/api/types.ts';

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
  return () => qc.invalidateQueries({ queryKey: CATALOG_KEY });
}

export function useCreateCatalogItem() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (req: CatalogItemRequest) => catalogApi.create(req),
    onSuccess: invalidate,
  });
}

export function useUpdateCatalogItem() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: CatalogItemRequest }) =>
      catalogApi.update(id, req),
    onSuccess: invalidate,
  });
}

export function useDeleteCatalogItem() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (id: string) => catalogApi.remove(id),
    onSuccess: invalidate,
  });
}

export function useResetCatalog() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: () => catalogApi.resetFromTemplate(),
    onSuccess: invalidate,
  });
}
