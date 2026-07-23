import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/api/auth.ts';
import type { AuthResponse, LoginRequest } from '@/api/types.ts';
import { tokens } from '@/lib/tokens.ts';
import { setSentryUser } from '@/lib/sentry.ts';
import { clearPersistedCache } from '@/lib/offlinePersist.ts';
import { clearOutbox } from '@/lib/outbox/outbox.ts';
import { ME_QUERY_KEY } from './useMe.ts';

export function useLogin() {
  const qc = useQueryClient();
  return useMutation<AuthResponse, unknown, LoginRequest>({
    mutationFn: authApi.login,
    onSuccess: (data) => {
      // Drop any cached server state from a previous account BEFORE priming the
      // new one. Without this, switching accounts without an explicit logout
      // (logout clears the cache, a fresh login did not) leaves the prior
      // user's warm queries — catalog/projects/clients keys aren't user-scoped
      // — visible to the new user until they refetch. Tenant-isolation bug.
      qc.clear();
      // Also drop the PERSISTED cache — a hard reload would otherwise rehydrate the previous
      // account's data before this session primes. Async; the persister re-saves the new cache.
      void clearPersistedCache();
      // And the outbox: a fresh login must never replay a prior account's unsynced writes under
      // the new user (cross-account safety). Re-sync-on-relogin for the SAME user is slice 3.
      void clearOutbox();
      tokens.set(data.accessToken, data.refreshToken);
      // Prime the cache so the dashboard renders instantly without
      // an extra /me round-trip.
      qc.setQueryData(ME_QUERY_KEY, data.user);
      // Tag error reports with the user id (no PII) for context.
      setSentryUser(data.user.id);
    },
  });
}
