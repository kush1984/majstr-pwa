import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notesApi } from '@/api/notes.ts';
import type { NoteRequest } from '@/api/types.ts';

const key = (objectId: string) => ['project-notes', objectId] as const;

/** The object's notes (owner). No plan gate — notes are on every plan. */
export function useNotes(objectId: string) {
  return useQuery({
    queryKey: key(objectId),
    queryFn: () => notesApi.list(objectId),
    enabled: Boolean(objectId),
  });
}

export function useNoteActions(objectId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: key(objectId) });

  return {
    add: useMutation({ mutationFn: (req: NoteRequest) => notesApi.add(objectId, req), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: (vars: { noteId: string; req: NoteRequest }) => notesApi.update(objectId, vars.noteId, vars.req),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (noteId: string) => notesApi.remove(objectId, noteId), onSuccess: invalidate }),
  };
}
