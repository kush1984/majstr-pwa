import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearOutbox, dropBlockedOps, enqueue, flushOutbox, getSyncStatus, listBlockedOps, listOutbox,
  MAX_ATTEMPTS, outboxCount, registerOutboxHandler, retryBlockedOps, setOutboxErrorClassifier,
} from './outbox.ts';

beforeEach(async () => {
  await clearOutbox();
  setOutboxErrorClassifier(() => 'retry'); // default; the blocked tests override it
});

describe('outbox engine', () => {
  it('replays ops in dependency order and clears them on success', async () => {
    const log: string[] = [];
    registerOutboxHandler('project', async (op) => { log.push(`project:${op.entityId}`); });
    registerOutboxHandler('estimate', async (op) => { log.push(`estimate:${op.entityId}`); });

    // Enqueue the estimate FIRST, but it depends on the object → the object must replay first.
    await enqueue({ entityId: 'p1', entity: 'project', type: 'create', payload: {}, deps: [] });
    await enqueue({ entityId: 'e1', entity: 'estimate', type: 'create', payload: {}, deps: ['p1'] });

    const result = await flushOutbox();

    expect(result).toEqual({ synced: 2, failed: 0 });
    expect(log).toEqual(['project:p1', 'estimate:e1']);
    expect(await outboxCount()).toBe(0);
  });

  it('a failed parent stays queued and blocks its dependents, then both land on retry', async () => {
    let parentFails = true;
    let estimateRan = false;
    registerOutboxHandler('project', async () => { if (parentFails) throw new Error('boom'); });
    registerOutboxHandler('estimate', async () => { estimateRan = true; });

    await enqueue({ entityId: 'p1', entity: 'project', type: 'create', payload: {}, deps: [] });
    await enqueue({ entityId: 'e1', entity: 'estimate', type: 'create', payload: {}, deps: ['p1'] });

    const first = await flushOutbox();
    expect(first).toEqual({ synced: 0, failed: 1 });
    expect(estimateRan).toBe(false);            // child never ran while its parent is unsynced
    expect(await outboxCount()).toBe(2);        // both still queued
    const [failed] = await listOutbox();
    expect(failed.status).toBe('failed');
    expect(failed.attempts).toBe(1);

    // Network heals → the next flush lands the parent, which unblocks the child.
    parentFails = false;
    const second = await flushOutbox();
    expect(second).toEqual({ synced: 2, failed: 0 });
    expect(estimateRan).toBe(true);
    expect(await outboxCount()).toBe(0);
  });

  it('leaves an op with no registered handler untouched (a newer build may own it)', async () => {
    await enqueue({ entityId: 'x1', entity: 'unknown-entity', type: 'create', payload: {}, deps: [] });
    const result = await flushOutbox();
    expect(result.synced).toBe(0);
    expect(await outboxCount()).toBe(1);
  });

  it('orders ops on the SAME entity: an update waits for its own create (no explicit dep)', async () => {
    let createFails = true;
    const log: string[] = [];
    registerOutboxHandler('client', async (op) => {
      if (op.type === 'create' && createFails) throw new Error('offline');
      log.push(op.type);
    });

    // create then update, same entityId, NO deps — per-entity ordering must still hold them in order.
    await enqueue({ entityId: 'c1', entity: 'client', type: 'create', payload: {}, deps: [] });
    await enqueue({ entityId: 'c1', entity: 'client', type: 'update', payload: {}, deps: [] });

    const first = await flushOutbox();
    expect(first.synced).toBe(0);
    expect(log).toEqual([]);              // update never ran ahead of its unsynced create
    expect(await outboxCount()).toBe(2);

    createFails = false;
    await flushOutbox();
    expect(log).toEqual(['create', 'update']); // create lands first, then the update
    expect(await outboxCount()).toBe(0);
  });

  it('an op that exhausts MAX_ATTEMPTS becomes BLOCKED, not a phantom "pending"', async () => {
    let calls = 0;
    registerOutboxHandler('client', async () => { calls += 1; throw new Error('always fails'); });
    await enqueue({ entityId: 'c1', entity: 'client', type: 'create', payload: {}, deps: [] });

    for (let i = 0; i < MAX_ATTEMPTS + 3; i++) await flushOutbox();

    expect(calls).toBe(MAX_ATTEMPTS);     // capped — no infinite retry loop
    expect(await outboxCount()).toBe(1);  // kept, never silently discarded

    // The regression this locks: it used to stay `failed`, which meant skipped by every
    // later flush YET counted as pending — the badge said "syncing…" forever, the master
    // believed the write would land, and there was no screen that listed it.
    const blocked = await listBlockedOps();
    expect(blocked).toHaveLength(1);
    expect(blocked[0].blockReason).toBe('stuck');
    expect(getSyncStatus().blocked).toBe(1);
    expect(getSyncStatus().pending).toBe(0);
  });

  it('a stuck op can be retried once the network is back', async () => {
    let failing = true;
    registerOutboxHandler('client', async () => { if (failing) throw new Error('offline'); });
    await enqueue({ entityId: 'c1', entity: 'client', type: 'create', payload: {}, deps: [] });
    for (let i = 0; i < MAX_ATTEMPTS; i++) await flushOutbox();
    expect(getSyncStatus().blocked).toBe(1);

    failing = false;
    await retryBlockedOps(); // resets attempts and flushes

    expect(await outboxCount()).toBe(0); // the write finally lands — not lost after all
  });

  it('tracks the pending count in the reactive sync status', async () => {
    registerOutboxHandler('client', async () => { /* ok */ });
    expect(getSyncStatus().pending).toBe(0);

    await enqueue({ entityId: 'a', entity: 'client', type: 'create', payload: {}, deps: [] });
    await enqueue({ entityId: 'b', entity: 'client', type: 'create', payload: {}, deps: [] });
    expect(getSyncStatus().pending).toBe(2);

    await flushOutbox(); // both land → queue empties
    expect(getSyncStatus().pending).toBe(0);
    expect(getSyncStatus().syncing).toBe(false);
  });

  it('blocks a permanently-rejected op (not auto-retried), then a retry after upgrade lands it', async () => {
    setOutboxErrorClassifier(() => 'limit');
    let overLimit = true;
    registerOutboxHandler('project', async () => { if (overLimit) throw new Error('403 limit'); });
    await enqueue({ entityId: 'p1', entity: 'project', type: 'create', payload: { name: 'X' }, deps: [] });

    await flushOutbox();
    expect(getSyncStatus().blocked).toBe(1);
    expect(getSyncStatus().pending).toBe(0);
    const blocked = await listBlockedOps();
    expect(blocked[0]).toMatchObject({ entityId: 'p1', status: 'blocked', blockReason: 'limit' });

    // A normal flush must NOT retry a blocked op.
    await flushOutbox();
    expect((await listBlockedOps()).length).toBe(1);

    // Upgrade → un-block + retry → it lands.
    overLimit = false;
    await retryBlockedOps();
    expect(getSyncStatus().blocked).toBe(0);
    expect(await outboxCount()).toBe(0);
  });

  it('dropBlockedOps discards blocked ops and returns their entityIds', async () => {
    setOutboxErrorClassifier(() => 'other');
    registerOutboxHandler('client', async () => { throw new Error('400'); });
    await enqueue({ entityId: 'c1', entity: 'client', type: 'create', payload: {}, deps: [] });
    await flushOutbox();
    expect(getSyncStatus().blocked).toBe(1);

    const dropped = await dropBlockedOps();
    expect(dropped).toEqual(['c1']);
    expect(await outboxCount()).toBe(0);
    expect(getSyncStatus().blocked).toBe(0);
  });

  it('dropping a blocked parent CASCADES to its children instead of orphaning them', async () => {
    // The real scenario: offline over the FREE cap the master creates object P, estimate E
    // under it, and an item I under E. Only P is blocked. Deleting P used to remove P alone,
    // which RELEASED E and I to replay against an object the server never got — they 404'd,
    // retried, and died stuck. One tap, three writes silently lost.
    setOutboxErrorClassifier((e) => ((e as Error).message === 'limit' ? 'limit' : 'retry'));
    let childRan = false;
    registerOutboxHandler('project', async () => { throw new Error('limit'); });
    registerOutboxHandler('estimate', async () => { childRan = true; });
    registerOutboxHandler('item', async () => { childRan = true; });

    await enqueue({ entityId: 'p1', entity: 'project', type: 'create', payload: {}, deps: [] });
    await enqueue({ entityId: 'e1', entity: 'estimate', type: 'create', payload: {}, deps: ['p1'] });
    await enqueue({ entityId: 'i1', entity: 'item', type: 'create', payload: {}, deps: ['e1'] });

    await flushOutbox();
    expect(getSyncStatus().blocked).toBe(1); // only the parent is blocked
    expect(await outboxCount()).toBe(3);     // children still waiting on it

    const dropped = await dropBlockedOps();

    // The grandchild goes too — it only reaches p1 through e1, so the closure must be transitive.
    expect([...dropped].sort()).toEqual(['e1', 'i1', 'p1']);
    expect(await outboxCount()).toBe(0);

    await flushOutbox();
    expect(childRan).toBe(false); // nothing was released to fire at a non-existent parent
  });

  it('clearOutbox empties the queue', async () => {
    registerOutboxHandler('client', async () => { /* no-op */ });
    await enqueue({ entityId: 'c1', entity: 'client', type: 'create', payload: {}, deps: [] });
    expect(await outboxCount()).toBe(1);
    await clearOutbox();
    expect(await outboxCount()).toBe(0);
  });
});
