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

import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

// `self.__WB_MANIFEST` is replaced at build time with the list of
// files Vite produced. Workbox uses it to cache the app shell.
precacheAndRoute(self.__WB_MANIFEST);

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

  event.waitUntil(self.registration.showNotification(title, options));
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
          existing.focus();
          return existing.navigate(target);
        }
        return self.clients.openWindow(target);
      }),
  );
});

// Activate updated SW immediately on next page load so the user does not
// stay on a stale build after autoUpdate finds a new version.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
