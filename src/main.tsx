import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { registerSW } from 'virtual:pwa-register';
import { markUpdateReady } from '@/lib/swUpdate.ts';
import { offlinePersister } from '@/lib/offlinePersist.ts';
import { initOutbox } from '@/lib/outbox/init.ts';
import { App } from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { initSentry } from './lib/sentry.ts';
import { captureRefFromUrl } from './lib/referral.ts';
import { shouldRetryQuery, queryRetryDelay } from './lib/queryRetry.ts';
import './lib/i18n.ts';
import './styles/index.css';

// Start error reporting before anything else so even early crashes are caught.
// No-op unless VITE_SENTRY_DSN is set.
initSentry();

// First-touch referral capture from ?ref= on the entry URL (stored once).
captureRefFromUrl(window.location.search);

// One shared QueryClient. Sensible defaults for this app:
//   - staleTime 30s: avoid hammering /me on every navigation
//   - retry: transient-only with backoff (the axios interceptor handles 401) —
//     policy lives in lib/queryRetry.ts so it can be unit-tested
//   - refetchOnWindowFocus: false — feels less twitchy on mobile
// gcTime is bumped to a week so inactive queries aren't evicted from memory before the
// persister snapshots them — that snapshot IS the offline read cache. Without a long gcTime the
// cache would be thin exactly when the master goes offline.
const WEEK_MS = 1000 * 60 * 60 * 24 * 7;
/** Offline-cache schema version — bump ONLY on an incompatible change to cached DTO shapes. */
const CACHE_SCHEMA = 'v1';
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: WEEK_MS,
      // 'offlineFirst' (not the default 'online'): serve the persisted cache and still FIRE the
      // request when the browser reports no network. The default PAUSES a query offline, leaving
      // it `pending` forever — that's what made the app hang on a spinner (and never render the
      // login page) with no connection. Paired with `shouldRetryQuery` refusing to retry offline,
      // a query now resolves fast: cached data, or a real error the UI can show.
      networkMode: 'offlineFirst',
      retry: shouldRetryQuery,
      retryDelay: queryRetryDelay,
      refetchOnWindowFocus: false,
    },
    mutations: {
      // NEVER let a mutation sit PAUSED offline. The default ('online') silently parks it until
      // reconnect, so the button spins forever and the master can't tell saving from hanging —
      // the same failure the offline spinner bug was. 'always' means a write either goes through
      // or fails honestly; the ones that must survive offline are queued by `offlineMutate`
      // (clients / objects / estimates / items), and the rest surface a real error.
      networkMode: 'always',
    },
  },
});

// Wire the offline outbox: register entity handlers + auto-flush queued writes on every reconnect.
initOutbox(queryClient);

// Service worker registration. A new build's SW installs and waits; instead of
// reloading silently (which would drop unsaved form input), we surface a banner
// («нова версія — оновити») and let the master reload when ready.
if ('serviceWorker' in navigator) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // A new version is waiting — tell the UI. Clicking «Оновити» activates it + reloads.
      // updateSW() resolves after the reload it triggers — nothing to await here.
      markUpdateReady(() => { void updateSW(true); });
    },
    onOfflineReady() {
      // PWA is cached and ready to work offline (app shell only — API
      // calls still need network). No prompt needed.
    },
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {/* Persist the query cache to IndexedDB so the app has data offline. `buster` must be a
          CACHE-SCHEMA version, NOT the app version: tying it to __APP_VERSION__ meant every single
          release wiped the master's offline data (update the app on the way to a site → nothing
          works in the basement). Bump CACHE_SCHEMA only when cached DTO shapes change
          incompatibly; `maxAge` still caps the cache's lifetime. */}
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister: offlinePersister, maxAge: WEEK_MS, buster: CACHE_SCHEMA }}
      >
        <App />
      </PersistQueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
