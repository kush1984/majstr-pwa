import { get, set, del } from 'idb-keyval';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { removeOldestQuery } from '@tanstack/react-query-persist-client';
import type { QueryClient } from '@tanstack/react-query';

/**
 * Offline read cache (Phase 0 of offline-first). The TanStack Query cache is persisted to
 * IndexedDB (via idb-keyval — async, generous quota) so the master's data survives a reload
 * and is there in a no-signal basement, not just an in-memory blank.
 *
 * SECURITY: this is a **temporary working copy on the device**. It is wiped on logout and on a
 * genuinely-dead session (see `clearPersistedCache`, wired into useLogin / useLogout /
 * `forceLogin`), so a borrowed phone or an account switch never leaks the previous user's data.
 * It is NEVER wiped merely because the access token expired offline — that would self-destruct
 * the feature (the JWT expires every few minutes; offline ≠ logged out).
 */
const CACHE_KEY = 'majstr-query-cache';

export const offlinePersister = createAsyncStoragePersister({
  key: CACHE_KEY,
  throttleTime: 1000,
  // The prefetch pulls a LOT (every object, estimate and item), so the serialized cache can outgrow
  // the storage quota. Without a retry the whole write fails and the master silently ends up with NO
  // offline data at all; `removeOldestQuery` drops the least-recently-used query and tries again, so
  // the cache degrades gracefully instead of disappearing.
  retry: removeOldestQuery,
  storage: {
    getItem: (key) => get<string>(key).then((v) => v ?? null),
    setItem: (key, value) => set(key, value),
    removeItem: (key) => del(key),
  },
});

/**
 * Which queries make it into the IndexedDB snapshot.
 *
 * React Query's default keeps only `status === 'success'`. That is actively wrong here: with
 * `networkMode: 'offlineFirst'` every screen opened without a signal fires a request, the request
 * fails, and the query flips to `error` — WITH its data still attached. The default then dropped
 * it from the next snapshot, so the offline cache erased itself as the master used it: reopen the
 * app in a basement and the catalog, the templates, whatever had been touched were simply gone.
 *
 * Keep everything that HAS data. Stale data beats a blank screen, and it is replaced the moment a
 * real fetch succeeds.
 */
export function shouldDehydrateQuery(query: { state: { data: unknown } }): boolean {
  return query.state.data !== undefined;
}

/**
 * Drop the persisted cache from IndexedDB. Fire-and-forget safe: NEVER throws — it runs inside
 * logout / login / the dead-session redirect, which must not break if IndexedDB is unavailable
 * (private mode, a quota error, or a test env with no `indexedDB` where `del` throws synchronously).
 */
export function clearPersistedCache(): Promise<void> {
  try {
    return Promise.resolve(del(CACHE_KEY)).catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

/**
 * Run once the snapshot is restored, BEFORE any screen subscribes: every restored query becomes
 * stale, so whatever is mounted asks the server once.
 *
 * <p>A restored query keeps the `dataUpdatedAt` it was saved with, and the snapshot is written up
 * to `throttleTime` behind the cache. Reopen the app within `staleTime` of that snapshot and the
 * last write is missing from it while the data still counts as fresh — nothing refetches, and
 * nothing ever will on a screen that stays mounted (focus refetch is off). The object just created
 * was absent from «Обʼєкти» for as long as the master looked at it. A cold start more than
 * `staleTime` later already refetched on mount; this makes a quick one behave the same.</p>
 *
 * <p>`refetchType: 'none'` marks without fetching, so nothing is refetched that is not on screen,
 * and the mount fetch is the same one a later cold start makes — offline it fails fast and the
 * restored data stays.</p>
 */
export function markRestoredStale(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ refetchType: 'none' });
}
