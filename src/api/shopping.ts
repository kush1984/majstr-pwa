import { api, ensureAccessToken } from './client.ts';
import { config } from '@/lib/config.ts';
import type {
  ShoppingListItemRequest,
  ShoppingListItemResponse,
  ShoppingListItemUpdateRequest,
  ShoppingListResponse,
  ShoppingListSummaryResponse,
} from './types.ts';

/**
 * The object's material shopping list. FREE on every plan, and offline on every screen — a
 * builders' merchant is a basement or a metal shed, so every write here goes through the outbox
 * and the add carries a client-supplied id so a replay cannot double a row.
 */
const base = (projectId: string) => `/api/projects/${projectId}/shopping-list`;

export const shoppingApi = {
  summary(): Promise<ShoppingListSummaryResponse[]> {
    return api.get<ShoppingListSummaryResponse[]>('/api/shopping-lists/summary').then((r) => r.data);
  },
  get(projectId: string): Promise<ShoppingListResponse> {
    return api.get<ShoppingListResponse>(base(projectId)).then((r) => r.data);
  },
  add(projectId: string, req: ShoppingListItemRequest, id?: string): Promise<ShoppingListItemResponse> {
    return api
      .post<ShoppingListItemResponse>(`${base(projectId)}/items`, req,
        id ? { headers: { 'X-Entity-Uuid': id } } : undefined)
      .then((r) => r.data);
  },
  update(
    projectId: string,
    itemId: string,
    req: ShoppingListItemUpdateRequest,
  ): Promise<ShoppingListItemResponse> {
    return api
      .patch<ShoppingListItemResponse>(`${base(projectId)}/items/${itemId}`, req)
      .then((r) => r.data);
  },
  remove(projectId: string, itemId: string): Promise<void> {
    return api.delete(`${base(projectId)}/items/${itemId}`).then(() => undefined);
  },
  clearBought(projectId: string): Promise<ShoppingListResponse> {
    return api.post<ShoppingListResponse>(`${base(projectId)}/clear-bought`).then((r) => r.data);
  },

  /**
   * The list as a PDF to hand to the client (V129) — the one action here that genuinely needs the
   * network. The endpoint streams bytes behind the Authorization header, so it can't be a plain
   * <a href>; the Blob (not an object URL) is what comes back, because sharing it wants a `File`.
   */
  async fetchPdfBlob(projectId: string): Promise<Blob> {
    // ensureAccessToken so this bare fetch gets the same proactive refresh as the axios paths.
    const access = await ensureAccessToken();
    const resp = await fetch(`${config.apiBaseUrl}${base(projectId)}/pdf`, {
      headers: { Authorization: `Bearer ${access ?? ''}` },
    });
    if (!resp.ok) {
      throw new Error(`Shopping list PDF request failed: ${resp.status}`);
    }
    return resp.blob();
  },
};
