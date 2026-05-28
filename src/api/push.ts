import { api } from './client.ts';

/**
 * Push subscription endpoints. The backend doesn't have these yet —
 * tracked in the open-questions log under "Email notifications".
 * Calling subscribe() will currently 404; the rest of the client flow
 * still runs so we catch the obvious wiring bugs early.
 *
 * TODO(backend): implement POST /api/push/subscribe (and DELETE) plus a
 * `push_subscriptions` table.
 */

export interface PushSubscriptionPayload {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export const pushApi = {
  subscribe(payload: PushSubscriptionPayload): Promise<void> {
    return api.post('/api/push/subscribe', payload).then(() => undefined);
  },

  unsubscribe(endpoint: string): Promise<void> {
    return api
      .delete('/api/push/subscribe', { data: { endpoint } })
      .then(() => undefined);
  },
};
