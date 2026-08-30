import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/api/auth.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { track } from '@/lib/posthog.ts';

/** Verify the email via the token from the link. Public endpoint. */
export function useVerifyEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => authApi.verifyEmail(token),
    onSuccess: () => {
      // The link often opens in a browser where nobody is logged in — then this is a no-op,
      // because an anonymous visitor never opted in. That is the correct outcome, not a gap.
      track('email_verified');
      // Refresh /me so the banner disappears (when the user is logged in).
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

/** Re-send the verification email to the current (authenticated) user. */
export function useResendVerification() {
  return useMutation({
    mutationFn: () => authApi.resendVerification(),
  });
}
