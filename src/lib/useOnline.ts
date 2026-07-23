import { useEffect, useState, useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/react-query';
import {
  getSyncStatus, listBlockedOps, subscribeSyncStatus, type SyncStatus,
} from '@/lib/outbox/outbox.ts';
import type { OutboxOp } from '@/lib/outbox/types.ts';

/**
 * Reactive online/offline state, sourced from TanStack Query's `onlineManager` (which tracks
 * `navigator.onLine` + the window online/offline events) — the same signal that pauses query
 * fetches offline, so the UI and the cache agree on "are we online". SSR-safe default: online.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
    () => true,
  );
}

/** Reactive outbox status — how many offline writes are queued, and whether a sync is running. */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus);
}

/** The blocked ops (permanently rejected — need a "PRO or delete" decision), refreshed live. */
export function useBlockedOps(): OutboxOp[] {
  const { blocked } = useSyncStatus();
  const [ops, setOps] = useState<OutboxOp[]>([]);
  useEffect(() => {
    let alive = true;
    void listBlockedOps().then((o) => { if (alive) setOps(o); });
    return () => { alive = false; };
  }, [blocked]);
  return ops;
}
