import { useCallback, useEffect, useState } from 'react';
import { isPushSupported, urlBase64ToUint8Array } from '@/lib/push.ts';
import { pushApi, type PushSubscribePayload } from '@/api/push.ts';
import { toAppError } from '@/api/errors.ts';
import i18n from '@/lib/i18n.ts';

type PermissionState = NotificationPermission | 'unsupported' | 'unknown';

interface UsePushResult {
  permission: PermissionState;
  isSubscribed: boolean;
  isReady: boolean;
  isBusy: boolean;
  enable: () => Promise<{ ok: boolean; error?: string }>;
  disable: () => Promise<void>;
}

/**
 * The server's VAPID public key, cached for the page's lifetime. We fetch it
 * from `GET /api/push/vapid-public-key` (single source of truth) instead of a
 * build-time env var, so rotating the key on the backend doesn't need a
 * frontend redeploy. `null` means push is not configured on the server.
 */
let vapidKeyPromise: Promise<string | null> | null = null;
function getVapidPublicKey(): Promise<string | null> {
  vapidKeyPromise ??= pushApi.getVapidPublicKey().catch((err) => {
    // Don't cache a failure — let the next enable() retry the fetch.
    vapidKeyPromise = null;
    throw err;
  });
  return vapidKeyPromise;
}

/**
 * Owns the web-push subscription lifecycle on the client side:
 *   1. Reads current Notification permission state.
 *   2. Checks whether the SW already has an active push subscription.
 *   3. Exposes enable() / disable() the Profile screen can call.
 *
 * Calling enable():
 *   - fetches the VAPID public key from the backend
 *   - prompts the user (ONLY when they click — never auto on load)
 *   - subscribes via the SW registration
 *   - posts the flat subscription to POST /api/push/subscribe
 *
 * disable() removes the subscription on the backend
 * (POST /api/push/unsubscribe) and locally.
 */
export function usePush(): UsePushResult {
  const supported = isPushSupported();
  const [permission, setPermission] = useState<PermissionState>(
    supported ? Notification.permission : 'unsupported',
  );
  const [isSubscribed, setSubscribed] = useState(false);
  const [isReady, setReady] = useState(false);
  const [isBusy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported) {
      setReady(true);
      return;
    }
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setSubscribed(sub !== null);
      } finally {
        setReady(true);
      }
    })();
  }, [supported]);

  const enable = useCallback<UsePushResult['enable']>(async () => {
    if (!supported) {
      return { ok: false, error: i18n.t('profile.pushNotSupported') };
    }

    setBusy(true);
    try {
      const vapidKey = await getVapidPublicKey();
      if (!vapidKey) {
        return { ok: false, error: i18n.t('profile.pushNotConfigured') };
      }

      // Permission prompt fires here — i.e. only on the user's click.
      const granted = await Notification.requestPermission();
      setPermission(granted);
      if (granted !== 'granted') {
        return { ok: false, error: i18n.t('profile.pushPermissionDenied') };
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      await pushApi.subscribe(subscriptionToPayload(sub));
      setSubscribed(true);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: toAppError(err).message };
    } finally {
      setBusy(false);
    }
  }, [supported]);

  const disable = useCallback<UsePushResult['disable']>(async () => {
    if (!supported) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setSubscribed(false);
        return;
      }
      try {
        await pushApi.unsubscribe(sub.endpoint);
      } catch {
        // Backend errors are non-fatal — we still drop the local subscription
        // so the toggle reflects the user's intent.
      }
      await sub.unsubscribe();
      setSubscribed(false);
    } finally {
      setBusy(false);
    }
  }, [supported]);

  return { permission, isSubscribed, isReady, isBusy, enable, disable };
}

/**
 * Re-POST the browser's current push subscription to the backend (upsert), so a
 * subscription the browser silently rotated (SW reinstall, push-service key
 * rotation) gets re-synced — otherwise the backend keeps sending to a stale
 * endpoint that FCM accepts (201) but the browser can't display. Best-effort
 * and silent: called on app open and on the SW's `pushsubscriptionchange`.
 * Runs in the app (not the SW) because the subscribe endpoint needs the bearer.
 */
export async function resyncPushSubscription(): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await pushApi.subscribe(subscriptionToPayload(sub));
    }
  } catch {
    // Non-fatal — a failed re-sync just means we retry on the next app open.
  }
}

function subscriptionToPayload(sub: PushSubscription): PushSubscribePayload {
  const json = sub.toJSON();
  return {
    endpoint: json.endpoint ?? sub.endpoint,
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  };
}
