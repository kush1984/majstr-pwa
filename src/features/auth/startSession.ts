import type { QueryClient } from '@tanstack/react-query';
import type { AuthResponse } from '@/api/types.ts';
import { tokens } from '@/lib/tokens.ts';
import { setSentryUser } from '@/lib/sentry.ts';
import { applyAnalyticsIdentity } from '@/lib/posthog.ts';
import { clearPersistedCache } from '@/lib/offlinePersist.ts';
import { discardForeignOps, kickOutboxSync } from '@/lib/outbox/outbox.ts';
import { toast } from '@/hooks/useToast.ts';
import i18n from '@/lib/i18n.ts';
import { ME_QUERY_KEY } from './useMe.ts';

/** IndexedDB can wedge on a phone, and that must not hold a login. The flush refuses foreign ops by
 *  itself, so running out of this wait costs only the tidying, never another master's privacy. */
const DISCARD_WAIT_MS = 2000;

/**
 * The one way a session begins, for login AND registration. Registration used to set the tokens and
 * nothing else, so on a phone a crew shares the new account inherited the previous master's queue
 * and his cached screens.
 *
 * Foreign work goes BEFORE the token is written: until then nothing can be sent as this master.
 */
export async function startSession(qc: QueryClient, data: AuthResponse): Promise<void> {
  // No query key is user-scoped, so a previous account's warm catalog/projects/clients would show
  // until refetched. The persisted copy goes too, or a hard reload rehydrates it.
  qc.clear();
  void clearPersistedCache();

  const kept = await Promise.race([
    discardForeignOps(data.user.id),
    new Promise<number>((resolve) => { setTimeout(() => resolve(0), DISCARD_WAIT_MS); }),
  ]);
  tokens.set(data.accessToken, data.refreshToken);

  // Primed so the dashboard renders without an extra /me round-trip.
  qc.setQueryData(ME_QUERY_KEY, data.user);
  setSentryUser(data.user.id);
  // `reset()` on logout wiped the analytics identity, so this is what makes the next master on a
  // shared phone their own person rather than an append to the previous one.
  applyAnalyticsIdentity(data.user);

  // What survived is this master's own unsynced work; say so, it should not be a silent surprise.
  if (kept > 0) toast.info(i18n.t('sync.restoredAfterLogin', { count: kept }));
  kickOutboxSync();
}
