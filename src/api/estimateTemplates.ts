import { api } from './client.ts';
import type {
  ApplyTemplatesRequest,
  EstimateCreateRequest,
  EstimateResponse,
  EstimateTemplateDetail,
  EstimateTemplateSummary,
  SaveAsTemplateRequest,
  TemplateItemRequest,
  TemplatePickRequest,
  TemplateItemsOrderRequest,
  TemplateTradeRequest,
} from './types.ts';

/**
 * Estimate templates — ready-made bundles of works for a typical job. The list
 * carries system defaults relevant to my trades plus my own saved templates;
 * applying one creates a normal, fully editable estimate (quantities empty,
 * prices substituted from my catalog by name).
 *
 * **A system default is FORKED ON WRITE.** The defaults are rows shared by every master, so the
 * first edit (rename, add/edit/remove/reorder a position) copies the bundle into my own editable
 * one and hides the original for me alone. Every write therefore answers with the template it
 * actually wrote — whose `id` may differ from the one asked for. **Follow the id you get back**;
 * a later write may keep addressing the default (the server resolves it to the same copy), but the
 * cache must re-key or the edits look like they vanished.
 */
export const estimateTemplatesApi = {
  /** Defaults relevant to my trades (+ general) plus my own templates. */
  list(): Promise<EstimateTemplateSummary[]> {
    return api.get<EstimateTemplateSummary[]>('/api/estimate-templates').then((r) => r.data);
  },

  /** A template's composition (its positions) — for the preview. */
  get(id: string): Promise<EstimateTemplateDetail> {
    return api.get<EstimateTemplateDetail>(`/api/estimate-templates/${id}`).then((r) => r.data);
  },

  /** Rename a template — a system default is forked on write (the answer carries the copy). */
  rename(id: string, req: SaveAsTemplateRequest): Promise<EstimateTemplateSummary> {
    return api.patch<EstimateTemplateSummary>(`/api/estimate-templates/${id}`, req).then((r) => r.data);
  },

  /** File a template under a trade (mine directly; a system default → my own override). */
  setTrade(id: string, req: TemplateTradeRequest): Promise<EstimateTemplateSummary> {
    return api
      .patch<EstimateTemplateSummary>(`/api/estimate-templates/${id}/trade`, req)
      .then((r) => r.data);
  },

  /**
   * Delete a template. My own is really deleted; a SYSTEM DEFAULT is a row shared by every
   * master, so it is hidden for me alone and comes back with {@link restoreDefaults}.
   */
  remove(id: string): Promise<void> {
    return api.delete(`/api/estimate-templates/${id}`).then(() => undefined);
  },

  /** Bring back every system default I hid (my own templates are left alone). */
  restoreDefaults(): Promise<EstimateTemplateSummary[]> {
    return api
      .post<EstimateTemplateSummary[]>('/api/estimate-templates/restore-defaults')
      .then((r) => r.data);
  },

  /** Add a position → updated detail (a system default is forked on write). */
  /** `id` (a client-generated UUID) rides the X-Entity-Uuid header → idempotent offline replay. */
  addItem(templateId: string, req: TemplateItemRequest, id?: string): Promise<EstimateTemplateDetail> {
    return api
      .post<EstimateTemplateDetail>(`/api/estimate-templates/${templateId}/items`, req,
        id ? { headers: { 'X-Entity-Uuid': id } } : undefined)
      .then((r) => r.data);
  },

  /** Remove a position → updated detail (a system default is forked on write). */
  removeItem(templateId: string, itemId: string): Promise<EstimateTemplateDetail> {
    return api
      .delete<EstimateTemplateDetail>(`/api/estimate-templates/${templateId}/items/${itemId}`)
      .then((r) => r.data);
  },

  /** Edit a position in place — name / type / unit. */
  updateItem(templateId: string, itemId: string, req: TemplateItemRequest): Promise<EstimateTemplateDetail> {
    return api
      .patch<EstimateTemplateDetail>(`/api/estimate-templates/${templateId}/items/${itemId}`, req)
      .then((r) => r.data);
  },

  /** Rearrange a template's positions — the whole order, so a replay is idempotent. */
  reorderItems(templateId: string, req: TemplateItemsOrderRequest): Promise<EstimateTemplateDetail> {
    return api
      .put<EstimateTemplateDetail>(`/api/estimate-templates/${templateId}/items/order`, req)
      .then((r) => r.data);
  },

  /** Save the current estimate as my own reusable template. */
  saveFromEstimate(estimateId: string, req: SaveAsTemplateRequest): Promise<EstimateTemplateSummary> {
    return api
      .post<EstimateTemplateSummary>(`/api/estimates/${estimateId}/save-as-template`, req)
      .then((r) => r.data);
  },

  /**
   * Create ONE new estimate in a project from one or more templates. The server concatenates the
   * picked bundles in order and drops a position the moment a name repeats, so overlapping
   * bundles (every tiling bundle carries «Ґрунтівка поверхні») cannot bill the same work twice.
   *
   * Each pick may name the positions to take out of that bundle — a big bundle is often applied
   * for five or six of its lines. Naming none takes the whole bundle.
   */
  applyToProject(
    projectId: string,
    picks: TemplatePickRequest[],
    req: EstimateCreateRequest,
  ): Promise<EstimateResponse> {
    const body: ApplyTemplatesRequest = { templates: picks, estimate: req };
    return api
      .post<EstimateResponse>(`/api/projects/${projectId}/estimates/from-templates`, body)
      .then((r) => r.data);
  },
};
