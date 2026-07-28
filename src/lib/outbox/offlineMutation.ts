import { onlineManager } from '@tanstack/react-query';
import axios from 'axios';
import { enqueue, enqueueLatest } from './outbox.ts';
import type { OutboxOpType } from './types.ts';

/** A dropped connection (no HTTP response) — as opposed to a real 4xx/5xx the server sent back. */
export function isNetworkError(e: unknown): boolean {
  return axios.isAxiosError(e) && !e.response;
}

/**
 * Run a write offline-first:
 * - **Online:** do the real call and return the server's entity (ordered, as before — so a
 *   dependent online call like "create an estimate on this new object" still sees it on the server).
 *   A genuine error (validation) is surfaced; only a NETWORK blip falls through to the queue.
 * - **Offline (or that blip):** write the optimistic entity to the cache and enqueue the op for
 *   dependency-ordered replay on reconnect.
 *
 * This deliberately queues ONLY when offline while not every entity is on the outbox yet — it keeps
 * online flows synchronous and race-free. Once all writes are queued, this can become always-queue.
 */
export async function offlineMutate<T>(opts: {
  entity: string;
  entityId: string;
  type: OutboxOpType;
  payload: unknown;
  deps?: string[];
  online: () => Promise<T>;
  optimistic: () => T;
  onOnlineSuccess?: () => void;
  /**
   * For an op that states the entity's WHOLE state, so a queued one is worthless once a newer one
   * exists — a reorder, not a create. Replaces the pending op instead of stacking behind it.
   */
  coalesce?: boolean;
}): Promise<T> {
  if (onlineManager.isOnline()) {
    try {
      const result = await opts.online();
      opts.onOnlineSuccess?.();
      return result;
    } catch (e) {
      if (!isNetworkError(e)) throw e; // real error → surface; network blip → queue below
    }
  }
  const optimistic = opts.optimistic();
  const queue = opts.coalesce ? enqueueLatest : enqueue;
  await queue({
    entityId: opts.entityId, entity: opts.entity, type: opts.type,
    payload: opts.payload, deps: opts.deps ?? [],
  });
  return optimistic;
}
