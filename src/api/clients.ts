import { api } from './client.ts';
import type { ClientRequest, ClientResponse } from './types.ts';

/** Clients CRUD — the source for inline client creation in the estimate flow. */
export const clientsApi = {
  list(): Promise<ClientResponse[]> {
    return api.get<ClientResponse[]>('/api/clients').then((r) => r.data);
  },

  get(id: string): Promise<ClientResponse> {
    return api.get<ClientResponse>(`/api/clients/${id}`).then((r) => r.data);
  },

  /**
   * Create a client. `id` (a client-generated UUID) is sent in the X-Entity-Uuid header so an
   * offline-authored create replays idempotently — the backend returns the existing client
   * instead of duplicating on a retry.
   */
  create(req: ClientRequest, id?: string): Promise<ClientResponse> {
    return api
      .post<ClientResponse>('/api/clients', req, id ? { headers: { 'X-Entity-Uuid': id } } : undefined)
      .then((r) => r.data);
  },

  update(id: string, req: ClientRequest): Promise<ClientResponse> {
    return api.put<ClientResponse>(`/api/clients/${id}`, req).then((r) => r.data);
  },

  remove(id: string): Promise<void> {
    return api.delete(`/api/clients/${id}`).then(() => undefined);
  },
};
