import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { tokens } from '@/lib/tokens';
import { routes } from '@/lib/config';

/**
 * Clears tokens, drops all cached server state, and routes to /login.
 * Doesn't call any backend endpoint — the access token will simply
 * expire on its own, and the refresh token is still in the DB until
 * the cleanup job (open-questions: "Background cleanup of expired
 * refresh tokens") reaps it. A proper logout endpoint that revokes
 * the refresh token would be safer; defer until needed.
 */
export function useLogout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useCallback(() => {
    tokens.clear();
    qc.clear();
    navigate(routes.login, { replace: true });
  }, [qc, navigate]);
}
