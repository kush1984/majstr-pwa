import { api } from './client.ts';
import type { TaskRequest, TaskResponse, TaskUpdateRequest } from './types.ts';

/** Object tasks («Що треба зробити») — owner-only, every plan. */
const base = (objectId: string) => `/api/projects/${objectId}/tasks`;

export const tasksApi = {
  list(objectId: string): Promise<TaskResponse[]> {
    return api.get<TaskResponse[]>(base(objectId)).then((r) => r.data);
  },
  add(objectId: string, req: TaskRequest, id?: string): Promise<TaskResponse> {
    return api
      .post<TaskResponse>(base(objectId), req, id ? { headers: { 'X-Entity-Uuid': id } } : undefined)
      .then((r) => r.data);
  },
  update(objectId: string, taskId: string, req: TaskUpdateRequest): Promise<TaskResponse> {
    return api.patch<TaskResponse>(`${base(objectId)}/${taskId}`, req).then((r) => r.data);
  },
  remove(objectId: string, taskId: string): Promise<void> {
    return api.delete(`${base(objectId)}/${taskId}`).then(() => undefined);
  },
};
