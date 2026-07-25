import { api } from './client.ts';
import type {
  EstimateCreateRequest,
  EstimateResponse,
  EstimateTemplateDetail,
  EstimateTemplateSummary,
  SaveAsTemplateRequest,
  TemplateItemRequest,
  TemplateTradeRequest,
} from './types.ts';

/**
 * Estimate templates — ready-made bundles of works for a typical job. The list
 * carries system defaults relevant to my trades plus my own saved templates;
 * applying one creates a normal, fully editable estimate (quantities empty,
 * prices substituted from my catalog by name).
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

  /** Rename my own template (defaults are read-only). */
  rename(id: string, req: SaveAsTemplateRequest): Promise<EstimateTemplateSummary> {
    return api.patch<EstimateTemplateSummary>(`/api/estimate-templates/${id}`, req).then((r) => r.data);
  },

  /** File a template under a trade (mine directly; a system default → my own override). */
  setTrade(id: string, req: TemplateTradeRequest): Promise<EstimateTemplateSummary> {
    return api
      .patch<EstimateTemplateSummary>(`/api/estimate-templates/${id}/trade`, req)
      .then((r) => r.data);
  },

  /** Delete my own template. */
  remove(id: string): Promise<void> {
    return api.delete(`/api/estimate-templates/${id}`).then(() => undefined);
  },

  /** Add a position to my own template → updated detail. */
  /** `id` (a client-generated UUID) rides the X-Entity-Uuid header → idempotent offline replay. */
  addItem(templateId: string, req: TemplateItemRequest, id?: string): Promise<EstimateTemplateDetail> {
    return api
      .post<EstimateTemplateDetail>(`/api/estimate-templates/${templateId}/items`, req,
        id ? { headers: { 'X-Entity-Uuid': id } } : undefined)
      .then((r) => r.data);
  },

  /** Remove a position from my own template → updated detail. */
  removeItem(templateId: string, itemId: string): Promise<EstimateTemplateDetail> {
    return api
      .delete<EstimateTemplateDetail>(`/api/estimate-templates/${templateId}/items/${itemId}`)
      .then((r) => r.data);
  },

  /** Save the current estimate as my own reusable template. */
  saveFromEstimate(estimateId: string, req: SaveAsTemplateRequest): Promise<EstimateTemplateSummary> {
    return api
      .post<EstimateTemplateSummary>(`/api/estimates/${estimateId}/save-as-template`, req)
      .then((r) => r.data);
  },

  /** Create a new estimate in a project from a template. */
  applyToProject(
    projectId: string,
    templateId: string,
    req: EstimateCreateRequest,
  ): Promise<EstimateResponse> {
    return api
      .post<EstimateResponse>(`/api/projects/${projectId}/estimates/from-template/${templateId}`, req)
      .then((r) => r.data);
  },
};
