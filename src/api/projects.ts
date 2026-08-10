import { api } from './client.ts';
import type {
  ObjectStage,
  ProjectRequest,
  ProjectResponse,
  ProjectStatus,
} from './types.ts';

/** Projects (construction sites) CRUD + status changes. */
export const projectsApi = {
  /** Filters on the derived {@link ObjectStage}, not the raw {@link ProjectStatus} column —
   *  object-status-unification. */
  list(stage?: ObjectStage): Promise<ProjectResponse[]> {
    return api
      .get<ProjectResponse[]>('/api/projects', {
        params: stage ? { stage } : undefined,
      })
      .then((r) => r.data);
  },

  get(id: string): Promise<ProjectResponse> {
    return api.get<ProjectResponse>(`/api/projects/${id}`).then((r) => r.data);
  },

  /** `id` (a client-generated UUID) rides the X-Entity-Uuid header → idempotent offline replay. */
  create(req: ProjectRequest, id?: string): Promise<ProjectResponse> {
    return api
      .post<ProjectResponse>('/api/projects', req, id ? { headers: { 'X-Entity-Uuid': id } } : undefined)
      .then((r) => r.data);
  },

  update(id: string, req: ProjectRequest): Promise<ProjectResponse> {
    return api.put<ProjectResponse>(`/api/projects/${id}`, req).then((r) => r.data);
  },

  setStatus(id: string, status: ProjectStatus): Promise<ProjectResponse> {
    return api
      .patch<ProjectResponse>(`/api/projects/${id}/status`, { status })
      .then((r) => r.data);
  },

  remove(id: string): Promise<void> {
    return api.delete(`/api/projects/${id}`).then(() => undefined);
  },
};
