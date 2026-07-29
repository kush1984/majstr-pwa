import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { messagesApi } from '@/api/messages.ts';

export const messagesKey = (projectId: string) => ['project-messages', projectId] as const;

/** Client questions for one project (Fix F). */
export function useProjectMessages(projectId: string, enabled = true) {
  return useQuery({
    queryKey: messagesKey(projectId),
    queryFn: () => messagesApi.listForProject(projectId),
    enabled: enabled && Boolean(projectId),
  });
}

/**
 * Mark questions read. Accepts a single id or a batch (e.g. all unread ones
 * when the contractor opens the project). Invalidates the project list so the
 * card "💬 N" indicator and the header bell counter update.
 */
export function useMarkMessagesRead(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageIds: string[]) =>
      Promise.all(messageIds.map((qid) => messagesApi.markRead(projectId, qid))),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: messagesKey(projectId) });
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

/**
 * Remove a message from the object. The object list is invalidated too: deleting an unread one has to
 * take its count off the row badge and the header bell, or they would keep pointing at nothing.
 */
export function useDeleteMessage(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => messagesApi.remove(projectId, messageId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: messagesKey(projectId) });
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}
