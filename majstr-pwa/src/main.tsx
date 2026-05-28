import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './styles/index.css';

// One shared QueryClient. Sensible defaults for this app:
//   - staleTime 30s: avoid hammering /me on every navigation
//   - retry: 1 — the axios interceptor already handles 401 refresh
//   - refetchOnWindowFocus: false — feels less twitchy on mobile
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
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
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
