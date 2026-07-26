import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notesApi } from '@/api/notes.ts';
import { newUuid } from '@/lib/uuid.ts';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import type { NoteRequest, NoteResponse } from '@/api/types.ts';

/** Exported so the offline prefetch primes the SAME key this hook reads. */
export const NOTES_KEY = (objectId: string) => ['project-notes', objectId] as const;
const key = NOTES_KEY;

/** The object's notes (owner). No plan gate — notes are on every plan. */
export function useNotes(objectId: string) {
  return useQuery({
    queryKey: key(objectId),
    queryFn: () => notesApi.list(objectId),
    enabled: Boolean(objectId),
  });
}

/**
 * Note CRUD — offline-first. A note is the most "on site" thing in the app («ключі в
 * консьєржа», a phone number scribbled at the door), so it is written precisely where there
 * is no signal. All three actions queue and replay; the backend add is idempotent via a
 * client id and the delete is a no-op when the note is already gone.
 */
export function useNoteActions(objectId: string) {
  const qc = useQueryClient();
  const invalidate = () => { void qc.invalidateQueries({ queryKey: key(objectId) }); };
  const patch = (edit: (list: NoteResponse[]) => NoteResponse[]) => {
    qc.setQueryData<NoteResponse[]>(key(objectId), (old) => edit(old ?? []));
  };

  return {
    add: useMutation({
      networkMode: 'always',
      mutationFn: (req: NoteRequest) => {
        const id = newUuid();
        const now = new Date().toISOString();
        return offlineMutate<void>({
          entity: 'note', entityId: id, type: 'create', payload: { objectId, req },
          deps: [objectId],
          online: async () => { await notesApi.add(objectId, req, id); },
          onOnlineSuccess: invalidate,
          // Newest first, matching the server's ordering.
          optimistic: () => patch((list) => [{
            id, title: req.title ?? null, phone: req.phone ?? null, body: req.body,
            createdAt: now, updatedAt: now,
          }, ...list]),
        });
      },
    }),
    update: useMutation({
      networkMode: 'always',
      mutationFn: (vars: { noteId: string; req: NoteRequest }) =>
        offlineMutate<void>({
          entity: 'note', entityId: vars.noteId, type: 'update',
          payload: { objectId, req: vars.req }, deps: [objectId],
          online: async () => { await notesApi.update(objectId, vars.noteId, vars.req); },
          onOnlineSuccess: invalidate,
          optimistic: () => patch((list) => list.map((n) => (n.id === vars.noteId
            ? { ...n, title: vars.req.title ?? null, phone: vars.req.phone ?? null, body: vars.req.body }
            : n))),
        }),
    }),
    remove: useMutation({
      networkMode: 'always',
      mutationFn: (noteId: string) =>
        offlineMutate<void>({
          entity: 'note', entityId: noteId, type: 'delete', payload: { objectId },
          deps: [objectId],
          online: async () => { await notesApi.remove(objectId, noteId); },
          onOnlineSuccess: invalidate,
          optimistic: () => patch((list) => list.filter((n) => n.id !== noteId)),
        }),
    }),
  };
}
