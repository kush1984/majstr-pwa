import axios from 'axios';
import { onlineManager } from '@tanstack/react-query';

/**
 * Shared React Query retry policy (queries only). Extracted from `main.tsx` so
 * it can be unit-tested in isolation.
 *
 * Retry transient failures — network/offline (no HTTP response) and server
 * errors (5xx) — up to {@link MAX_QUERY_RETRIES} times with exponential
 * backoff. Never retry 4xx (400/401/403/404/409/422/429): those are
 * deterministic (auth, validation, not-found, rate-limit) and retrying just
 * wastes time or hammers the server. Mutations keep React Query's default of
 * NO retry — we don't want to risk duplicate writes (POST/PUT).
 *
 * **Never retry while OFFLINE.** With `networkMode: 'offlineFirst'` a query fires once even
 * with no network; if we then asked for a retry, React Query would PAUSE it until reconnect and
 * the query would sit in `status: 'pending'` forever — which is exactly how the app used to hang
 * on a spinner offline (the login page never rendered). Failing fast instead lets the UI fall
 * back to the persisted cache, or show an honest "no connection" state.
 */
export const MAX_QUERY_RETRIES = 3;

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (!onlineManager.isOnline()) return false; // offline → fail fast, never pause on a retry
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === undefined) return true; // network / offline / timeout
    return status >= 500 && status <= 599; // server errors only
  }
  return false; // unknown error shape — don't loop
}

/** Exponential backoff, capped at 10s. */
export function queryRetryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 10_000);
}
