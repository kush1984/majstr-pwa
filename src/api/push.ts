import { api } from './client.ts';

/**
 * Web-push subscription endpoints. The backend (Step 8) owns the VAPID
 * keypair, stores one row per browser subscription, and fans push out to
 * every device a contractor has enabled.
 *
 * Contract (mirrors the Spring DTOs verbatim):
 *  - GET  /api/push/vapid-public-key → { publicKey: string | null }
 *      `null` means push is not configured on the server.
 *  - POST /api/push/subscribe   (bearer) → 204, body is the FLAT shape below
 *  - POST /api/push/unsubscribe (bearer) → 204, body { endpoint }
 *
 * Note the subscribe body is flat (endpoint + p256dh + auth + userAgent),
 * NOT the nested `PushSubscriptionJSON` the browser produces — `usePush`
 * flattens it before calling here.
 */

export interface VapidPublicKeyResponse {
  publicKey: string | null;
}

export interface PushSubscribePayload {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}

export const pushApi = {
  getVapidPublicKey(): Promise<string | null> {
    return api
      .get<VapidPublicKeyResponse>('/api/push/vapid-public-key')
      .then((r) => r.data.publicKey);
  },

  subscribe(payload: PushSubscribePayload): Promise<void> {
    return api.post('/api/push/subscribe', payload).then(() => undefined);
  },

  unsubscribe(endpoint: string): Promise<void> {
    return api.post('/api/push/unsubscribe', { endpoint }).then(() => undefined);
  },
};
