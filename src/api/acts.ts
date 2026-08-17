import { api, ensureAccessToken } from './client.ts';
import { config } from '@/lib/config.ts';
import type {
  ActProgressResponse,
  WorkActCreateRequest,
  WorkActItemsRequest,
  WorkActResponse,
  WorkActSignOfflineRequest,
  WorkActUpdateRequest,
} from './types.ts';

/**
 * Work acts (Акти виконаних робіт). Money (total / payable) is computed by the backend and read
 * off the response — the client never sums it. line_total / cumulative_before on the items are
 * server-authored too; the client only sends quantities.
 */
export const actsApi = {
  list(projectId: string): Promise<WorkActResponse[]> {
    return api.get<WorkActResponse[]>(`/api/projects/${projectId}/acts`).then((r) => r.data);
  },

  progress(projectId: string): Promise<ActProgressResponse> {
    return api.get<ActProgressResponse>(`/api/projects/${projectId}/acts/progress`).then((r) => r.data);
  },

  /** `id` (a client UUID) rides X-Entity-Uuid → idempotent offline replay of the draft create. */
  create(projectId: string, req: WorkActCreateRequest, id?: string): Promise<WorkActResponse> {
    return api
      .post<WorkActResponse>(`/api/projects/${projectId}/acts`, req,
        id ? { headers: { 'X-Entity-Uuid': id } } : undefined)
      .then((r) => r.data);
  },

  get(id: string): Promise<WorkActResponse> {
    return api.get<WorkActResponse>(`/api/acts/${id}`).then((r) => r.data);
  },

  updateHeader(id: string, req: WorkActUpdateRequest): Promise<WorkActResponse> {
    return api.patch<WorkActResponse>(`/api/acts/${id}`, req).then((r) => r.data);
  },

  replaceItems(id: string, req: WorkActItemsRequest): Promise<WorkActResponse> {
    return api.put<WorkActResponse>(`/api/acts/${id}/items`, req).then((r) => r.data);
  },

  remove(id: string): Promise<void> {
    return api.delete(`/api/acts/${id}`).then(() => undefined);
  },

  signOffline(id: string, req: WorkActSignOfflineRequest): Promise<WorkActResponse> {
    return api.post<WorkActResponse>(`/api/acts/${id}/sign-offline`, req).then((r) => r.data);
  },

  /** Same blob pattern as the estimate PDF — a bearer fetch, not a plain <a href>. */
  async fetchPdf(id: string): Promise<{ url: string; revoke: () => void }> {
    const access = await ensureAccessToken();
    const resp = await fetch(`${config.apiBaseUrl}/api/acts/${id}/pdf`, {
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
