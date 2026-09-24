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
export const CLIENT_DRIVEN_QUERY = { refetchOnWindowFocus: true } as const;
