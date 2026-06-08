import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/api/auth.ts';
import type { AuthResponse, LoginRequest } from '@/api/types.ts';
import { tokens } from '@/lib/tokens.ts';
import { setSentryUser } from '@/lib/sentry.ts';
import { ME_QUERY_KEY } from './useMe.ts';

export function useLogin() {
  const qc = useQueryClient();
  return useMutation<AuthResponse, unknown, LoginRequest>({
    mutationFn: authApi.login,
    onSuccess: (data) => {
      tokens.set(data.accessToken, data.refreshToken);
      // Prime the cache so the dashboard renders instantly without
      // an extra /me round-trip.
      qc.setQueryData(ME_QUERY_KEY, data.user);
      // Tag error reports with the user id (no PII) for context.
      setSentryUser(data.user.id);
    },
  });
}
