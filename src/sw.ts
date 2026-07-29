/// <reference lib="webworker" />

/**
 * Custom service worker (injectManifest strategy).
 *
 * Three jobs:
 *  1. Precache the app shell so the PWA can boot offline.
 *  2. Handle web-push events when the backend sends them.
 *  3. Open the app when the user taps a notification.
 *
 * API requests are intentionally NOT cached — they are user-specific
 * and short-lived. The runtime route for `/api/*` simply falls through
 * to the network.
 */

import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

// `self.__WB_MANIFEST` is replaced at build time with the list of
// files Vite produced. Workbox uses it to cache the app shell.
precacheAndRoute(self.__WB_MANIFEST);

/**
 * SPA navigation fallback — REQUIRED for a deep route to open offline.
 *
 * Precaching alone only matches URLs that are IN the manifest: `/` resolves (directoryIndex →
 * index.html), but `/projects/123`, `/estimates/abc`, `/profile` do not. Without this route those
 * navigations fall through to the network and, with no signal, the master gets the browser's
 * "no internet" page — the app appears completely broken offline the moment they aren't on the
 * home screen (or simply pull-to-refresh). `navigateFallback` in vite.config only configures the
 * DEV service worker (which is disabled), so with `injectManifest` we must register it ourselves.
 *
 * `/api/**` is denied so a same-origin API navigation is never answered with the app shell.
 */
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//] }),
);

// ---------- push ----------

self.addEventListener('push', (event) => {
  const data = (() => {
    try {
      return event.data?.json() ?? {};
    } catch {
      return { title: 'Majstr', body: event.data?.text() ?? '' };
    }
  })() as { title?: string; body?: string; url?: string };

  const title = data.title ?? 'Majstr';
  const options: NotificationOptions = {
    body: data.body ?? '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url ?? '/dashboard' },
  };

  // Tell any open tab as well as showing the notification. A push is the only moment the server has
  // news the app did not ask for, and without this an app already on screen kept its stale counts —
  // the bell only caught up on a manual refresh.
  const notify = self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then((clients) => {
      for (const client of clients) {
        client.postMessage({ type: 'push', url: data.url ?? null });
      }
    })
    // Best effort: failing to reach a tab must never cost the notification itself.
    .catch(() => undefined);

  event.waitUntil(Promise.all([self.registration.showNotification(title, options), notify]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | null)?.url ?? '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // Reuse an existing tab if one is open on our origin.
        const existing = clients.find((c) => c.url.includes(self.location.origin));
        if (existing) {
          // Focus is best-effort (some browsers reject it without a user gesture);
          // the navigate below is what the waitUntil actually keeps alive.
          void existing.focus();
          return existing.navigate(target);
        }
        return self.clients.openWindow(target);
      }),
  );
});

// Activate updated SW immediately on next page load so the user does not
// stay on a stale build after autoUpdate finds a new version.
self.addEventListener('install', () => { void self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ---------- subscription rotation ----------

// The push service can rotate/expire a subscription (e.g. after an SW update or
// a key rotation). Re-subscribe with the same VAPID key so the browser keeps a
// live subscription, then nudge any open client to re-POST it to the backend.
// The SW can't call the protected /api/push/subscribe itself (no auth token),
// so the client does it; an app-open re-sync is the backstop when none is open.
self.addEventListener('pushsubscriptionchange', (event) => {
  const evt = event as ExtendableEvent & { oldSubscription: PushSubscription | null };
  evt.waitUntil(
    (async () => {
      const applicationServerKey = evt.oldSubscription?.options?.applicationServerKey;
      if (!applicationServerKey) return; // can't re-subscribe without the original key
      try {
        await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
        const clients = await self.clients.matchAll({ includeUncontrolled: true });
        for (const client of clients) {
          client.postMessage({ type: 'push-subscription-changed' });
        }
      } catch {
        // Best-effort; the next app open re-syncs via resyncPushSubscription().
      }
    })(),
  );
});
