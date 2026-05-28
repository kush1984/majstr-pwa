import { useCallback, useEffect, useState } from 'react';
import { config } from '@/lib/config.ts';
import { isPushSupported, urlBase64ToUint8Array } from '@/lib/push.ts';
import { pushApi, type PushSubscriptionPayload } from '@/api/push.ts';
import { toAppError } from '@/api/errors.ts';

type PermissionState = NotificationPermission | 'unsupported' | 'unknown';

interface UsePushResult {
  permission: PermissionState;
  isSubscribed: boolean;
  isReady: boolean;
  enable: () => Promise<{ ok: boolean; error?: string }>;
  disable: () => Promise<void>;
}

/**
 * Owns the web-push subscription lifecycle on the client side:
 *   1. Reads current Notification permission state.
 *   2. Checks whether the SW already has an active push subscription.
 *   3. Exposes enable() / disable() the dashboard button can call.
 *
 * Calling enable():
 *   - prompts the user (only when they click — never auto)
 *   - subscribes via the SW registration
 *   - posts the subscription to /api/push/subscribe
 *
 * The backend endpoint is a known TODO — see src/api/push.ts. If it
 * 404s the local subscription still exists on the device; the next
 * iteration of the backend will pick it up when the user retries.
 */
export function usePush(): UsePushResult {
  const supported = isPushSupported();
  const [permission, setPermission] = useState<PermissionState>(
    supported ? Notification.permission : 'unsupported',
  );
  const [isSubscribed, setSubscribed] = useState(false);
  const [isReady, setReady] = useState(false);

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
      return { ok: false, error: 'Браузер не підтримує push-сповіщення' };
    }
    if (!config.vapidPublicKey) {
      return {
        ok: false,
        error: 'VAPID-ключ не налаштовано. Додайте VITE_VAPID_PUBLIC_KEY у .env',
      };
    }

    const granted = await Notification.requestPermission();
    setPermission(granted);
    if (granted !== 'granted') {
      return { ok: false, error: 'Дозвіл на сповіщення не надано' };
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey),
      });
      const payload = subscriptionToPayload(sub);
      await pushApi.subscribe(payload);
      setSubscribed(true);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: toAppError(err).message };
    }
  }, [supported]);

  const disable = useCallback<UsePushResult['disable']>(async () => {
    if (!supported) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    try {
      await pushApi.unsubscribe(sub.endpoint);
    } catch {
      // backend errors are non-fatal — we still drop the local subscription
    }
    await sub.unsubscribe();
    setSubscribed(false);
  }, [supported]);

  return { permission, isSubscribed, isReady, enable, disable };
}

function subscriptionToPayload(sub: PushSubscription): PushSubscriptionPayload {
  const json = sub.toJSON();
  return {
    endpoint: json.endpoint ?? sub.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: {
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
    },
  };
}
