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

/** True on iPhone / iPad (incl. iPadOS reporting itself as desktop Safari). */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ pretends to be macOS but exposes touch points.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/**
 * True when the PWA is running as an installed app (added to the home
 * screen) rather than inside a normal browser tab. iOS only delivers web
 * push to standalone PWAs, so the UI uses this to show an install hint.
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari exposes this non-standard flag instead of display-mode.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  // Back the array with an explicit ArrayBuffer so the type is
  // Uint8Array<ArrayBuffer> (not <ArrayBufferLike>). pushManager.subscribe
  // expects BufferSource, which a possibly-SharedArrayBuffer-backed array
  // does not satisfy under TS 5.7+ lib types.
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; ++i) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}
