import { api } from './client.ts';
import type {
  CatalogItemRequest,
  CatalogItemResponse,
  CatalogResetResponse,
  ItemType,
} from './types.ts';

/** Contractor's reusable library of works and materials. */
export const catalogApi = {
  list(type?: ItemType): Promise<CatalogItemResponse[]> {
    return api
      .get<CatalogItemResponse[]>('/api/catalog', {
        params: type ? { type } : undefined,
      })
      .then((r) => r.data);
  },

  /** Distinct categories for the picker / autocomplete. */
  categories(): Promise<string[]> {
    return api.get<string[]>('/api/catalog/categories').then((r) => r.data);
  },

  create(req: CatalogItemRequest): Promise<CatalogItemResponse> {
    return api.post<CatalogItemResponse>('/api/catalog', req).then((r) => r.data);
  },

  update(id: string, req: CatalogItemRequest): Promise<CatalogItemResponse> {
    return api.put<CatalogItemResponse>(`/api/catalog/${id}`, req).then((r) => r.data);
  },

  remove(id: string): Promise<void> {
    return api.delete(`/api/catalog/${id}`).then(() => undefined);
  },

  /** Seed starter templates for the user's trades (idempotent). */
  resetFromTemplate(): Promise<CatalogResetResponse> {
    return api
      .post<CatalogResetResponse>('/api/catalog/reset-from-template')
      .then((r) => r.data);
  },
};
