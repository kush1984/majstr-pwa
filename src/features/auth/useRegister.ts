import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/api/auth.ts';
import type { AuthResponse, RegisterRequest } from '@/api/types.ts';
import { track } from '@/lib/posthog.ts';
import { getStoredRef, getStoredUtm } from '@/lib/referral.ts';
import { startSession } from './startSession.ts';

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
    onSuccess: async (data) => {
      // Identity BEFORE the event: the SDK boots opted out, so a capture sent first would be
      // dropped. The registration form is where consent is ticked, so it is stamped by now.
      await startSession(qc, data);
      // The two first-touch tags this device stored on arrival. `/me` carries neither, so this
      // event is the only place they reach analytics at all.
      track('registered', { source: getStoredRef(), utm_source: getStoredUtm().utmSource });
    },
  });
}
