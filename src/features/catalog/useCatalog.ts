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
