import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import { markUpdateReady } from '@/lib/swUpdate.ts';
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
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: shouldRetryQuery,
      retryDelay: queryRetryDelay,
      refetchOnWindowFocus: false,
    },
  },
});

// Service worker registration. A new build's SW installs and waits; instead of
// reloading silently (which would drop unsaved form input), we surface a banner
// («нова версія — оновити») and let the master reload when ready.
if ('serviceWorker' in navigator) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // A new version is waiting — tell the UI. Clicking «Оновити» activates it + reloads.
      markUpdateReady(() => updateSW(true));
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
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
