import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '@/api/auth.ts';
import { tokens } from '@/lib/tokens.ts';
import { setSentryUser } from '@/lib/sentry.ts';
import { clearPersistedCache } from '@/lib/offlinePersist.ts';
import { clearOutbox } from '@/lib/outbox/outbox.ts';
import { routes } from '@/lib/config.ts';

/**
 * Logs the user out: revokes the refresh token server-side, then clears local
 * tokens + cached server state and routes to /login.
 *
 * The server-side revocation (`POST /api/auth/logout`) is **best-effort and
 * fire-and-forget** — we never block (or fail) the local logout on it, so the
 * user still logs out instantly when offline. Without it the refresh token
 * would stay valid in the DB for its full TTL after logout (a stolen token
 * from a shared device would keep working). On failure the token still expires
 * naturally and the cleanup job reaps it.
 */
export function useLogout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useCallback(() => {
    const refreshToken = tokens.getRefresh();
    if (refreshToken) {
      void authApi.logout(refreshToken).catch(() => undefined);
    }
    tokens.clear();
    setSentryUser(null);
    qc.clear();
    void clearPersistedCache(); // the local copy is temporary — logout wipes it from the device
    void clearOutbox();         // and any unsynced writes (Phase 1 slice 3 warns before this)
    navigate(routes.login, { replace: true });
  }, [qc, navigate]);
}
