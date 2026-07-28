import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/api/auth.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import type { UserResponse } from '@/api/types.ts';

/**
 * Ask the SERVER whether the email is verified, right now, before blocking on it.
 *
 * Reported from production: masters clicked the link in their mail, and the app kept showing
 * «Підтвердіть email». The link opens in the mail app's browser — a different React Query cache —
 * so {@link useVerifyEmail}'s invalidation lands there, not in the instance they were working in.
 * That instance holds `me` with `gcTime` of a week, restored from IndexedDB on load, and the global
 * `refetchOnWindowFocus: false` means returning to it refetches nothing. The flag never updated, and
 * the actions gated on it stayed shut — while the server, which is the real authority (EstimateService,
 * ShareLinkService, ProjectPortalService, BillingService all check it), would have allowed them.
 *
 * So a gate must not trust a cached `false`. A cached `true` is safe to trust: verification is
 * one-way, so it cannot go stale in the direction that wrongly blocks someone.
 *
 * Offline the cached value is all there is — a master with no signal keeps whatever we last knew
 * rather than being told to go verify an email they already verified.
 */
export function useEmailGate() {
  const qc = useQueryClient();

  return useCallback(async (): Promise<boolean> => {
    const cached = qc.getQueryData<UserResponse>(ME_QUERY_KEY);
    if (cached?.emailVerified) return true;

    try {
      const fresh = await qc.fetchQuery<UserResponse>({
        queryKey: ME_QUERY_KEY,
        queryFn: authApi.me,
        staleTime: 0, // the whole point: ignore what the cache thinks and ask
      });
      return fresh.emailVerified;
    } catch {
      return cached?.emailVerified ?? false;
    }
  }, [qc]);
}
