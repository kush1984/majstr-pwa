import { api } from './client.ts';
import type { MessageLinkState } from './types.ts';

/**
 * Owner-side control of the object's message link — the one a master sends to a supplier or a
 * colleague to get a message back. Deliberately not the portal link: that one carries the client's
 * prices, and this one carries nothing but the object's name.
 *
 * `state` mints on first ask and reuses after, so a URL already sent in a chat keeps working.
 */
export const messageLinkApi = {
  state(projectId: string): Promise<MessageLinkState> {
    return api
      .get<MessageLinkState>(`/api/projects/${projectId}/message-link`)
      .then((r) => r.data);
  },

  /** Anyone still holding the old URL gets a 404; the next `state` mints a fresh one. */
  revoke(projectId: string): Promise<void> {
    return api.delete(`/api/projects/${projectId}/message-link`).then(() => undefined);
  },
};
