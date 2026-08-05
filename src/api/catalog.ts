import { api } from './client.ts';
import type {
  CatalogItemRequest,
  CatalogItemResponse,
  CatalogResetResponse,
  CatalogUpdateNoticeResponse,
  ItemType,
  TemplateUpdatesResponse,
  Trade,
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

  /**
   * Delete several positions at once. Returns how many actually went — smaller than the list when
   * a row was already gone from another device, or when an offline delete is being replayed.
   */
  deleteItems(ids: string[]): Promise<{ deleted: number }> {
    return api
      .delete<{ deleted: number }>('/api/catalog/items', { data: { ids } })
      .then((r) => r.data);
  },

  /**
   * The master's own arrangement, stated in full rather than as a diff — so the offline outbox can
   * replay it any number of times and land in the same place.
   */
  reorder(items: { id: string; category: string | null }[]): Promise<CatalogItemResponse[]> {
    return api
      .patch<CatalogItemResponse[]>('/api/catalog/items/order', { items })
      .then((r) => r.data);
  },

  /**
   * Type-ahead search over the CURRENT contractor's catalog by partial name
   * (case-insensitive), capped server-side. Powers the add-item autocomplete.
   * Backend contract: `GET /api/catalog/search?q=<text>&limit=<n>` →
   * `CatalogItemResponse[]` (owner-scoped). Until the endpoint ships the
   * autocomplete falls back to client-side filtering of the loaded catalog.
   */
  search(q: string, limit = 10): Promise<CatalogItemResponse[]> {
    return api
      .get<CatalogItemResponse[]>('/api/catalog/search', { params: { q, limit } })
      .then((r) => r.data);
  },

  /** `id` (a client-generated UUID) rides the X-Entity-Uuid header → idempotent offline replay. */
  create(req: CatalogItemRequest, id?: string): Promise<CatalogItemResponse> {
    return api
      .post<CatalogItemResponse>('/api/catalog', req, id ? { headers: { 'X-Entity-Uuid': id } } : undefined)
      .then((r) => r.data);
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

  /** Merge the starter set for the given trades into the catalog — adds only
   *  missing items, never overwrites or duplicates. Used after adding a trade. */
  addFromTemplate(trades: Trade[]): Promise<CatalogResetResponse> {
    return api
      .post<CatalogResetResponse>('/api/catalog/add-from-template', { trades })
      .then((r) => r.data);
  },

  /** How many NEW default items (newer catalog version, my trades, not already
   *  in my catalog) the "Add new from library" button would add — for the preview. */
  templateUpdates(): Promise<TemplateUpdatesResponse> {
    return api
      .get<TemplateUpdatesResponse>('/api/catalog/template-updates')
      .then((r) => r.data);
  },

  /** Add those NEW default items — a merge: never overwrites prices, never
   *  duplicates, never re-adds what the user deleted/renamed. */
  addNewFromTemplate(): Promise<CatalogResetResponse> {
    return api
      .post<CatalogResetResponse>('/api/catalog/add-new-from-template')
      .then((r) => r.data);
  },

  /** A pending "we changed your catalog" notice, written by a catalog migration that rewrote the
   *  master's own catalog without them asking. `pending: false` when there is nothing to show. */
  updateNotice(): Promise<CatalogUpdateNoticeResponse> {
    return api
      .get<CatalogUpdateNoticeResponse>('/api/catalog/update-notice')
      .then((r) => r.data);
  },

  dismissUpdateNotice(): Promise<void> {
    return api.post('/api/catalog/update-notice/dismiss').then(() => undefined);
  },
};
