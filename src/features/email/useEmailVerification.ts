import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/api/auth.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';

/** Verify the email via the token from the link. Public endpoint. */
export function useVerifyEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => authApi.verifyEmail(token),
    onSuccess: () => {
      // Refresh /me so the banner disappears (when the user is logged in).
      qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

/** Re-send the verification email to the current (authenticated) user. */
export function useResendVerification() {
  return useMutation({
    mutationFn: () => authApi.resendVerification(),
  });
}
