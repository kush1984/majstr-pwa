import { api, ensureAccessToken } from './client.ts';
import { config } from '@/lib/config.ts';
import type {
  BatchCatalogItemEntry,
  EstimateConsolidateRequest,
  EstimateCreateRequest,
  EstimateDuplicateRequest,
  EstimateItemFromCatalogRequest,
  EstimateItemRequest,
  EstimateItemResponse,
  EstimateItemsOrderRequest,
  EstimateResponse,
  EstimateSummary,
  EstimateUpdateRequest,
} from './types.ts';

/**
 * Estimates + their line items. Totals (worksSubtotal / materialsSubtotal /
 * total) are computed by the backend and returned on EstimateResponse — the
 * client never sums money itself.
 */
export const estimatesApi = {
  // ---- under a project ----
  listForProject(projectId: string): Promise<EstimateSummary[]> {
    return api
      .get<EstimateSummary[]>(`/api/projects/${projectId}/estimates`)
      .then((r) => r.data);
  },

  /** `id` (a client-generated UUID) rides the X-Entity-Uuid header → idempotent offline replay. */
  createForProject(
    projectId: string,
    req: EstimateCreateRequest,
    id?: string,
  ): Promise<EstimateResponse> {
    return api
      .post<EstimateResponse>(`/api/projects/${projectId}/estimates`, req,
        id ? { headers: { 'X-Entity-Uuid': id } } : undefined)
      .then((r) => r.data);
  },

  /** Fold several of the object's estimates into one new DRAFT estimate. */
  consolidate(
    projectId: string,
    req: EstimateConsolidateRequest,
  ): Promise<EstimateResponse> {
    return api
      .post<EstimateResponse>(`/api/projects/${projectId}/estimates/consolidate`, req)
      .then((r) => r.data);
  },

  // ---- single estimate ----
  get(id: string): Promise<EstimateResponse> {
    return api.get<EstimateResponse>(`/api/estimates/${id}`).then((r) => r.data);
  },

  update(id: string, req: EstimateUpdateRequest): Promise<EstimateResponse> {
    return api.put<EstimateResponse>(`/api/estimates/${id}`, req).then((r) => r.data);
  },

  remove(id: string): Promise<void> {
    return api.delete(`/api/estimates/${id}`).then(() => undefined);
  },

  /** Reopen a SIGNED estimate for edits (owner only) → status back to DRAFT,
   *  signature cleared. The client must sign again afterwards. */
  reopen(id: string): Promise<EstimateResponse> {
    return api.post<EstimateResponse>(`/api/estimates/${id}/reopen`).then((r) => r.data);
  },

  /** Toggle whether this estimate counts toward the object's economy (income). */
  setCountInEconomy(id: string, countInEconomy: boolean): Promise<EstimateResponse> {
    return api
      .patch<EstimateResponse>(`/api/estimates/${id}/count-in-economy`, { countInEconomy })
      .then((r) => r.data);
  },

  // ---- items ----
  /** `id` (a client-generated UUID) rides the X-Entity-Uuid header → idempotent offline replay. */
  addItem(estimateId: string, req: EstimateItemRequest, id?: string): Promise<EstimateItemResponse> {
    return api
      .post<EstimateItemResponse>(`/api/estimates/${estimateId}/items`, req,
        id ? { headers: { 'X-Entity-Uuid': id } } : undefined)
      .then((r) => r.data);
  },

  addItemFromCatalog(
    estimateId: string,
    catalogItemId: string,
    req: EstimateItemFromCatalogRequest,
    id?: string,
  ): Promise<EstimateItemResponse> {
    return api
      .post<EstimateItemResponse>(
        `/api/estimates/${estimateId}/items/from-catalog/${catalogItemId}`,
        req,
        id ? { headers: { 'X-Entity-Uuid': id } } : undefined,
      )
      .then((r) => r.data);
  },

  /** Add several catalog items at once (multi-select) → updated estimate. */
  addItemsFromCatalogBatch(
    estimateId: string,
    items: BatchCatalogItemEntry[],
  ): Promise<EstimateResponse> {
    return api
      .post<EstimateResponse>(`/api/estimates/${estimateId}/items/batch`, { items })
      .then((r) => r.data);
  },

  updateItem(
    estimateId: string,
    itemId: string,
    req: EstimateItemRequest,
  ): Promise<EstimateItemResponse> {
    return api
      .put<EstimateItemResponse>(`/api/estimates/${estimateId}/items/${itemId}`, req)
      .then((r) => r.data);
  },

  reorderItems(estimateId: string, req: EstimateItemsOrderRequest): Promise<EstimateResponse> {
    return api
      .put<EstimateResponse>(`/api/estimates/${estimateId}/items/order`, req)
      .then((r) => r.data);
  },

  removeItem(estimateId: string, itemId: string): Promise<void> {
    return api
      .delete(`/api/estimates/${estimateId}/items/${itemId}`)
      .then(() => undefined);
  },

  /**
   * Remove several lines in ONE request.
   *
   * Not a loop over {@link removeItem}: trimming «УСІ ПЛИТОЧНІ РОБОТИ» down to a real job is ~130
   * deletions, and as many calls means 130 chances to fail on a phone — leaving an estimate
   * half-trimmed with no way to see which half. POST, not DELETE-with-a-body, because proxies drop
   * bodies on DELETE and losing the list would report success having deleted nothing.
   */
  deleteItems(estimateId: string, itemIds: string[]): Promise<void> {
    return api
      .post(`/api/estimates/${estimateId}/items/delete`, { itemIds })
      .then(() => undefined);
  },

  /** Copy an estimate, marking the chosen lines up — the foreman's crew price vs client price. */
  duplicate(estimateId: string, req: EstimateDuplicateRequest): Promise<EstimateResponse> {
    return api
      .post<EstimateResponse>(`/api/estimates/${estimateId}/duplicate`, req)
      .then((r) => r.data);
  },

  /**
   * The PDF endpoint streams bytes with the Authorization header, so it can't
   * be a plain <a href>. Fetch as a blob and hand back an object URL the
   * caller can open / download, plus a revoke fn to free it.
   */
  async fetchPdf(id: string, receiptIds: string[] = []): Promise<{ url: string; revoke: () => void }> {
    // Goes through ensureAccessToken so this bearer call gets the same
    // proactive-refresh guarantee as the axios paths.
    const access = await ensureAccessToken();
    // Chosen receipts (if any) ride as `?receipts=id1,id2`; the server embeds only those genuinely
    // linked to this estimate, so a bad id is harmless.
    const query = receiptIds.length ? `?receipts=${receiptIds.join(',')}` : '';
    const resp = await fetch(`${config.apiBaseUrl}/api/estimates/${id}/pdf${query}`, {
      headers: { Authorization: `Bearer ${access ?? ''}` },
    });
    if (!resp.ok) {
      throw new Error(`PDF request failed: ${resp.status}`);
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    return { url, revoke: () => URL.revokeObjectURL(url) };
  },
};
