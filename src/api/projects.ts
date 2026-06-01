import { api } from './client.ts';
import type {
  ProjectRequest,
  ProjectResponse,
  ProjectStatus,
} from './types.ts';

/** Projects (construction sites) CRUD + status changes. */
export const projectsApi = {
  list(status?: ProjectStatus): Promise<ProjectResponse[]> {
    return api
      .get<ProjectResponse[]>('/api/projects', {
        params: status ? { status } : undefined,
      })
      .then((r) => r.data);
  },

  get(id: string): Promise<ProjectResponse> {
    return api.get<ProjectResponse>(`/api/projects/${id}`).then((r) => r.data);
  },

  create(req: ProjectRequest): Promise<ProjectResponse> {
    return api.post<ProjectResponse>('/api/projects', req).then((r) => r.data);
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
