import { api } from './client.ts';
import type {
  ExpenseRequest,
  ExpenseResponse,
  ObjectEconomyResponse,
} from './types.ts';

/**
 * Object economy (PRO): per-object expense journal + real-profit summary. Every
 * call is PRO-gated on the backend (FREE → 403 UPGRADE_REQUIRED) and owner-scoped.
 * This data is owner-only — it never reaches the client portal / PDF / share link.
 */
export const economyApi = {
  economy(objectId: string): Promise<ObjectEconomyResponse> {
    return api.get<ObjectEconomyResponse>(`/api/projects/${objectId}/economy`).then((r) => r.data);
  },

  listExpenses(objectId: string): Promise<ExpenseResponse[]> {
    return api.get<ExpenseResponse[]>(`/api/projects/${objectId}/expenses`).then((r) => r.data);
  },

  addExpense(objectId: string, req: ExpenseRequest, id?: string): Promise<ExpenseResponse> {
    return api
      .post<ExpenseResponse>(`/api/projects/${objectId}/expenses`, req,
        id ? { headers: { 'X-Entity-Uuid': id } } : undefined)
      .then((r) => r.data);
  },

  updateExpense(objectId: string, expenseId: string, req: ExpenseRequest): Promise<ExpenseResponse> {
    return api
      .patch<ExpenseResponse>(`/api/projects/${objectId}/expenses/${expenseId}`, req)
      .then((r) => r.data);
  },

  deleteExpense(objectId: string, expenseId: string): Promise<void> {
    return api.delete(`/api/projects/${objectId}/expenses/${expenseId}`).then(() => undefined);
  },
};
