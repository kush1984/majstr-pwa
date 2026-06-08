import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { initSentry } from './lib/sentry.ts';
import { shouldRetryQuery, queryRetryDelay } from './lib/queryRetry.ts';
import './lib/i18n.ts';
import './styles/index.css';

// Start error reporting before anything else so even early crashes are caught.
// No-op unless VITE_SENTRY_DSN is set.
initSentry();

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

// Service worker registration. `autoUpdate` means the SW will replace
// itself when a new build is deployed; we trigger a reload so the user
// sees the new code on next navigation.
if ('serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onNeedRefresh() {
      // Quiet auto-update: a more polished version would show a toast
      // ("Доступна нова версія — оновити") with a manual reload button.
      // For now, autoUpdate handles it.
    },
    onOfflineReady() {
      // PWA is cached and ready to work offline (app shell only — API
      // calls still need network).
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
