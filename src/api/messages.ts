import { api, ensureAccessToken } from './client.ts';
import { config } from '@/lib/config.ts';
import type { MessageView } from './types.ts';

/**
 * Messages left on an object — by a client on the portal, or by anyone the master sent their message
 * link to. Owner-only; 403 on someone else's object.
 *   GET    /api/projects/{projectId}/messages              -> MessageView[]
 *   PATCH  /api/projects/{projectId}/messages/{id}/read    -> the updated message
 *   DELETE /api/projects/{projectId}/messages/{id}         -> 204
 *   GET    /api/projects/{projectId}/messages/{id}/files/{fileId} -> the bytes
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

  /**
   * An attachment as an object URL (the caller revokes it).
   *
   * <p>The endpoint is owner-authenticated, so a plain href or img src cannot reach it — the bytes are
   * fetched with the bearer token, exactly as photos are. The server answers with
   * `Content-Disposition: attachment`, which a fetch ignores, so what the app does with the blob is its
   * own decision: preview a photo, hand a PDF to the browser.</p>
   */
  async fetchFileUrl(projectId: string, messageId: string, fileId: string): Promise<string> {
    const access = await ensureAccessToken();
    const resp = await fetch(
      `${config.apiBaseUrl}/api/projects/${projectId}/messages/${messageId}/files/${fileId}`,
      { headers: { Authorization: `Bearer ${access ?? ''}` } },
    );
    if (!resp.ok) throw new Error(`Attachment request failed: ${resp.status}`);
    return URL.createObjectURL(await resp.blob());
  },
};
