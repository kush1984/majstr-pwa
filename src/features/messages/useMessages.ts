import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { messagesApi } from '@/api/messages.ts';
import type { MessageView } from '@/api/types.ts';

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
 * Mark messages read. Accepts a single id or a batch (all the unread ones when the master opens the
 * object).
 *
 * <p>The list is written straight into the cache instead of being invalidated. That matters visually:
 * the highlight is driven by `isRead`, so a refetch round trip would leave the message looking unread
 * for as long as it takes — which is exactly what made it feel like the tap did nothing. The project
 * list still gets invalidated, since the row's "💬 N" and the header bell are counted server-side.</p>
 */
export function useMarkMessagesRead(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageIds: string[]) =>
      Promise.all(messageIds.map((qid) => messagesApi.markRead(projectId, qid))),
    onSuccess: (_data, messageIds) => {
      const marked = new Set(messageIds);
      qc.setQueryData<MessageView[]>(messagesKey(projectId), (old) =>
        old?.map((m) => (marked.has(m.id) ? { ...m, isRead: true } : m)),
      );
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
