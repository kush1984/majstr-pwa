import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/api/auth.ts';
import type { AuthResponse, LoginRequest } from '@/api/types.ts';
import { tokens } from '@/lib/tokens.ts';
import { setSentryUser } from '@/lib/sentry.ts';
import { applyAnalyticsIdentity } from '@/lib/posthog.ts';
import { clearPersistedCache } from '@/lib/offlinePersist.ts';
import { discardForeignOps } from '@/lib/outbox/outbox.ts';
import { toast } from '@/hooks/useToast.ts';
import i18n from '@/lib/i18n.ts';
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
      tokens.set(data.accessToken, data.refreshToken);
      // The outbox is no longer wiped on logout, so a queue may be waiting here. Keep only what
      // THIS master authored and destroy the rest before any request goes out — that is what
      // makes retention safe. What survives is their own unsynced work, which the normal
      // reconnect flush then drains; tell them so it isn't a silent surprise.
      void discardForeignOps(data.user.id).then((kept) => {
        if (kept > 0) toast.info(i18n.t('sync.restoredAfterLogin', { count: kept }));
      });
      // Prime the cache so the dashboard renders instantly without
      // an extra /me round-trip.
      qc.setQueryData(ME_QUERY_KEY, data.user);
      // Tag error reports with the user id (no PII) for context.
      setSentryUser(data.user.id);
      // Analytics identity too — `reset()` on logout deliberately wiped it, so this is what makes
      // the next master on a shared phone their own person rather than an append to the previous.
      applyAnalyticsIdentity(data.user);
    },
  });
}
