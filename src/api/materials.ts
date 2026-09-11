import { api } from './client.ts';
import type {
  MaterialApplyRequest,
  MaterialAvailabilityResponse,
  MaterialCalculationResponse,
  MaterialNormResponse,
  MaterialNormUpdateRequest,
  ShoppingListResponse,
} from './types.ts';

/**
 * «Скільки матеріалу купити» — the estimate's works turned into a buying list (V127).
 *
 * The calculation is a GET because the server stores nothing: it is a view of the estimate,
 * recomputed on every request. No model runs, so the instance's 12 s timeout is right here — do
 * NOT add this to the long-timeout rule in `client.ts`.
 */
const base = (estimateId: string) => `/api/estimates/${estimateId}/materials`;

export const materialsApi = {
  calculate(
    estimateId: string,
    params: { wastePercent?: number; perimeter?: number } = {},
  ): Promise<MaterialCalculationResponse> {
    return api
      .get<MaterialCalculationResponse>(base(estimateId), { params })
      .then((r) => r.data);
  },
  /** Is there anything to calculate here? Asked before the entry points are offered, not after. */
  availability(estimateId: string): Promise<MaterialAvailabilityResponse> {
    return api
      .get<MaterialAvailabilityResponse>(`${base(estimateId)}/availability`)
      .then((r) => r.data);
  },
  toShoppingList(estimateId: string, req: MaterialApplyRequest): Promise<ShoppingListResponse> {
    return api
      .post<ShoppingListResponse>(`${base(estimateId)}/shopping-list`, req)
      .then((r) => r.data);
  },
  /** Correct one coefficient and keep it: the answer's `id` may be a fresh fork's, not the URL's. */
  saveNorm(normId: string, req: MaterialNormUpdateRequest): Promise<MaterialNormResponse> {
    return api.put<MaterialNormResponse>(`/api/material-norms/${normId}`, req).then((r) => r.data);
  },
  restoreNorm(normId: string): Promise<void> {
    return api.delete(`/api/material-norms/${normId}`).then(() => undefined);
  },
};
