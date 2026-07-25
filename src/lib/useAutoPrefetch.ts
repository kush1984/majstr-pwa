import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '@/features/auth/useMe.ts';
import { useOnline } from '@/lib/useOnline.ts';
import { prefetchForOffline, prefetchIsFresh } from '@/lib/offlinePrefetch.ts';

/**
 * Quietly fill the offline cache in the background once the master is logged in and online, so a
 * screen they never opened isn't blank in a basement. Throttled (see `prefetchIsFresh`) and
 * re-armed when the network comes back — a master who leaves the app open until signal returns
 * still gets prepared. Failures are ignored: this is best-effort warming, never a blocking step.
 */
export function useAutoPrefetch(): void {
  const qc = useQueryClient();
  const online = useOnline();
  const { data: me } = useMe();
  const running = useRef(false);

  useEffect(() => {
    if (!online || !me || running.current || prefetchIsFresh()) return;
    running.current = true;
    void prefetchForOffline(qc, { isPro: (me.plan ?? 'FREE') !== 'FREE' })
      .catch(() => undefined)
      .finally(() => {
        running.current = false;
      });
  }, [qc, online, me]);
}
