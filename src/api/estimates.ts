import { api, ensureAccessToken } from './client.ts';
import { config } from '@/lib/config.ts';
import type {
  BatchCatalogItemEntry,
  EstimateConsolidateRequest,
  EstimateCreateRequest,
  EstimateItemFromCatalogRequest,
  EstimateItemRequest,
  EstimateItemResponse,
  EstimateResponse,
  EstimateSummary,
  EstimateUpdateRequest,
  ShareLinkResponse,
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

  createForProject(
    projectId: string,
    req: EstimateCreateRequest,
  ): Promise<EstimateResponse> {
    return api
      .post<EstimateResponse>(`/api/projects/${projectId}/estimates`, req)
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
  addItem(estimateId: string, req: EstimateItemRequest): Promise<EstimateItemResponse> {
    return api
      .post<EstimateItemResponse>(`/api/estimates/${estimateId}/items`, req)
      .then((r) => r.data);
  },

  addItemFromCatalog(
    estimateId: string,
    catalogItemId: string,
    req: EstimateItemFromCatalogRequest,
  ): Promise<EstimateItemResponse> {
    return api
      .post<EstimateItemResponse>(
        `/api/estimates/${estimateId}/items/from-catalog/${catalogItemId}`,
        req,
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

  removeItem(estimateId: string, itemId: string): Promise<void> {
    return api
      .delete(`/api/estimates/${estimateId}/items/${itemId}`)
      .then(() => undefined);
  },

  // ---- share link ----
  createShareLink(id: string): Promise<ShareLinkResponse> {
    return api
      .post<ShareLinkResponse>(`/api/estimates/${id}/share`)
      .then((r) => r.data);
  },

  /** Email the portal link to the estimate's client (creates a link if none yet).
   *  400 CLIENT_EMAIL_MISSING when the client has no email on file. */
  sendShareEmail(id: string): Promise<ShareLinkResponse> {
    return api
      .post<ShareLinkResponse>(`/api/estimates/${id}/share/send-email`)
      .then((r) => r.data);
  },

  revokeShareLink(id: string, linkId: string): Promise<void> {
    return api
      .delete(`/api/estimates/${id}/share/${linkId}`)
      .then(() => undefined);
  },

  /**
   * The PDF endpoint streams bytes with the Authorization header, so it can't
   * be a plain <a href>. Fetch as a blob and hand back an object URL the
   * caller can open / download, plus a revoke fn to free it.
   */
  async fetchPdf(id: string): Promise<{ url: string; revoke: () => void }> {
    // Goes through ensureAccessToken so this bearer call gets the same
    // proactive-refresh guarantee as the axios paths.
    const access = await ensureAccessToken();
    const resp = await fetch(`${config.apiBaseUrl}/api/estimates/${id}/pdf`, {
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
