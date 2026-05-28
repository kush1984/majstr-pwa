import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/api/auth';
import type { AuthResponse, LoginRequest } from '@/api/types';
import { tokens } from '@/lib/tokens';
import { ME_QUERY_KEY } from './useMe';

export function useLogin() {
  const qc = useQueryClient();
  return useMutation<AuthResponse, unknown, LoginRequest>({
    mutationFn: authApi.login,
    onSuccess: (data) => {
      tokens.set(data.accessToken, data.refreshToken);
      // Prime the cache so the dashboard renders instantly without
      // an extra /me round-trip.
      qc.setQueryData(ME_QUERY_KEY, data.user);
    },
  });
}
