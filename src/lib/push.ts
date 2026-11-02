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

const PUSH_OWNER_KEY = 'majstr.pushOwner';

/**
 * Drops this device's subscription and remembers whose it was, so the same master gets it back at their
 * next login and nobody else on a shared phone does (P-80). Answers the endpoint it dropped. Best effort:
 * `getRegistration`, not `ready`, because `ready` never settles with no worker. No api import, since the
 * forced logout in `api/client.ts` calls this.
 */
export async function dropLocalPushSubscription(ownerId: string | null): Promise<string | null> {
  if (!isPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return null;
    if (ownerId) localStorage.setItem(PUSH_OWNER_KEY, ownerId);
    await sub.unsubscribe();
    return sub.endpoint;
  } catch {
    return null;
  }
}

/** Whose subscription a logout dropped, once: whoever opens the app next settles it either way. */
export function takeRememberedPushOwner(): string | null {
  try {
    const owner = localStorage.getItem(PUSH_OWNER_KEY);
    localStorage.removeItem(PUSH_OWNER_KEY);
    return owner;
  } catch {
    return null;
  }
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
