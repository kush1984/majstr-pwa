import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/api/auth';
import type { AuthResponse, RegisterRequest } from '@/api/types';
import { tokens } from '@/lib/tokens';
import { ME_QUERY_KEY } from './useMe';

/**
 * Today: register returns access + refresh tokens immediately, so we
 * auto-login (write tokens, prime /me cache, the calling component
 * navigates to /dashboard).
 *
 * TODO(open-questions: "Email verification on register"): when the
 * backend adds email confirmation, register should no longer return
 * tokens. Instead navigate to a "перевір пошту" screen and only
 * issue tokens after the confirmation link is hit.
 */
export function useRegister() {
  const qc = useQueryClient();
  return useMutation<AuthResponse, unknown, RegisterRequest>({
    mutationFn: authApi.register,
    onSuccess: (data) => {
      tokens.set(data.accessToken, data.refreshToken);
      qc.setQueryData(ME_QUERY_KEY, data.user);
    },
  });
}
