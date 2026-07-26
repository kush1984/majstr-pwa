import { api } from './client.ts';
import type { NoteRequest, NoteResponse } from './types.ts';

/**
 * Object notes (Нотатки) — free text + optional title/phone a master keeps against an
 * object. Owner-only; PRIVATE (never in the portal/PDF/share). Available on every plan.
 */
const base = (objectId: string) => `/api/projects/${objectId}/notes`;

export const notesApi = {
  list(objectId: string): Promise<NoteResponse[]> {
    return api.get<NoteResponse[]>(base(objectId)).then((r) => r.data);
  },
  add(objectId: string, req: NoteRequest, id?: string): Promise<NoteResponse> {
    return api
      .post<NoteResponse>(base(objectId), req, id ? { headers: { 'X-Entity-Uuid': id } } : undefined)
      .then((r) => r.data);
  },
  update(objectId: string, noteId: string, req: NoteRequest): Promise<NoteResponse> {
    return api.patch<NoteResponse>(`${base(objectId)}/${noteId}`, req).then((r) => r.data);
  },
  remove(objectId: string, noteId: string): Promise<void> {
    return api.delete(`${base(objectId)}/${noteId}`).then(() => undefined);
  },
};
