/**
 * Web-push helpers. Two small jobs:
 *
 * 1. Convert a base64url VAPID public key into the Uint8Array that
 *    `pushManager.subscribe()` wants.
 * 2. Detect whether the browser supports push notifications at all
 *    (so the UI can hide the button instead of erroring).
 *
 * The actual subscribe / unsubscribe orchestration lives in
 * `hooks/usePush.ts` so React state can react to the result.
 */

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}
