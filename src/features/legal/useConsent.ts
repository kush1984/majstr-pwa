import { useMutation, useQueryClient } from '@tanstack/react-query';
import { profileApi } from '@/api/profile.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import type { UserResponse } from '@/api/types.ts';

/** Record privacy-policy consent (existing-user login modal). Primes the me cache. */
export function useRecordConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => profileApi.consent(),
    onSuccess: (user: UserResponse) => qc.setQueryData(ME_QUERY_KEY, user),
  });
}

/** Acknowledge responsibility for client data (shown once). Primes the me cache. */
export function useAcknowledgeClientData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => profileApi.acknowledgeClientData(),
    onSuccess: (user: UserResponse) => qc.setQueryData(ME_QUERY_KEY, user),
  });
}
