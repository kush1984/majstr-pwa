import { get, set, del } from 'idb-keyval';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';

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
  storage: {
    getItem: (key) => get<string>(key).then((v) => v ?? null),
    setItem: (key, value) => set(key, value),
    removeItem: (key) => del(key),
  },
});

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
