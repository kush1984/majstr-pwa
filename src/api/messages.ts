import { api } from './client.ts';
import type { MessageView } from './types.ts';

/**
 * Messages left on an object — by a client on the portal, or by anyone the master sent their message
 * link to. Owner-only; 403 on someone else's object.
 *   GET    /api/projects/{projectId}/messages              -> MessageView[]
 *   PATCH  /api/projects/{projectId}/messages/{id}/read    -> the updated message
 *   DELETE /api/projects/{projectId}/messages/{id}         -> 204
 *
 * The backend still answers the old /questions paths so an app nobody has updated keeps working, and
 * ProjectResponse.unreadQuestions keeps its name for the same reason. Both get renamed once the
 * installed apps have caught up.
 */
export const messagesApi = {
  listForProject(projectId: string): Promise<MessageView[]> {
    return api
      .get<MessageView[]>(`/api/projects/${projectId}/messages`)
      .then((r) => r.data);
  },

  markRead(projectId: string, messageId: string): Promise<void> {
    return api
      .patch(`/api/projects/${projectId}/messages/${messageId}/read`)
      .then(() => undefined);
  },

  remove(projectId: string, messageId: string): Promise<void> {
    return api
      .delete(`/api/projects/${projectId}/messages/${messageId}`)
      .then(() => undefined);
  },
};
