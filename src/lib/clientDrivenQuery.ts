import { getSyncStatus } from '@/lib/outbox/outbox.ts';

/**
 * Query options for data the CLIENT can change behind the master's back.
 *
 * <p>Almost everything in this app changes because the master did something, and a mutation
 * invalidates what it touched. Four things do not: a client opens the portal and SIGNS an estimate
 * or an act, pays, or asks a question. The server learns immediately; the master's open tab learns
 * nothing, because `refetchOnWindowFocus` is off globally and nothing in his session fires.</p>
 *
 * <p>So he signs on his phone, switches back to the browser, and the estimate is still sitting in
 * «Кошториси» as if nothing happened — «треба рефрешити пейджу». A push does cover this when
 * notifications are on (see `usePushRefresh`), but that is permission-gated and off on plenty of
 * desktops, so it cannot be the only path.</p>
 *
 * <p>Refetching on focus, not polling: the moment he looks at the screen is exactly the moment the
 * answer has to be current, and `staleTime` still keeps a tab-switch every few seconds from turning
 * into a request. Offline the fetch fails fast and the cached answer stays on screen
 * (`networkMode: 'offlineFirst'`).</p>
 */
export const CLIENT_DRIVEN_QUERY = {
  refetchOnWindowFocus: () => !outboxBusy(),
} as const;

/**
 * Whether the queue is mid-air — the one state in which a focus refetch must NOT fire.
 *
 * <p>The flush runs on the same `visibilitychange` as this refetch, and the GET usually comes back
 * first: with the server's state, which does not yet contain the queued ops, straight over the
 * optimistic cache. The master walked back into the kitchen and his three lines were gone — for
 * 15 s on a good link, for two minutes on a failing op — so he typed them again, and the replay
 * then landed the originals too (review P-42).</p>
 *
 * <p>Deliberately the WHOLE queue, not «ops for this query key»: an op names an entity id, not a
 * query key, and a wrong mapping would fail in exactly the direction that costs work. Nothing is
 * lost by waiting — the flush invalidates everything it changed when it finishes, which is a
 * better-informed refetch than this one would have been.</p>
 */
function outboxBusy(): boolean {
  const status = getSyncStatus();
  // `runnable`, not `pending`: an op waiting behind a blocked one stays pending until the master
  // resolves the sync sheet, and a gate on it shut this refetch app-wide for that long — a SIGNED
  // estimate or act then surfaced only through a push (review P-55). Nothing held there can land
  // on its own, so there is nothing for the refetch to race.
  return status.runnable > 0 || status.syncing;
}
