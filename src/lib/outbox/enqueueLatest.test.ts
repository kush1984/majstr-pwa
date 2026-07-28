import { beforeEach, describe, expect, it } from 'vitest';
import { clearOutbox, enqueue, enqueueLatest, listOutbox } from './outbox.ts';

/**
 * Coalescing, for ops that state an entity's WHOLE state.
 *
 * Dragging lines around offline produces one arrangement per drop, and each request overwrites the
 * whole order — so keeping them all would spend N round trips arriving where the last one already
 * points, and would park the server on arrangements the master had already abandoned. What must NOT
 * coalesce is anything that is a distinct fact rather than a successive draft: two creates are two
 * lines, not one line described twice.
 */
const ORDER = { entity: 'estimateItemOrder', type: 'update' as const, deps: ['e1'] };

beforeEach(async () => {
  await clearOutbox();
});

describe('enqueueLatest', () => {
  it('keeps only the last arrangement for an estimate', async () => {
    await enqueueLatest({ ...ORDER, entityId: 'e1', payload: { req: { items: [{ id: 'a' }] } } });
    await enqueueLatest({ ...ORDER, entityId: 'e1', payload: { req: { items: [{ id: 'b' }] } } });
    await enqueueLatest({ ...ORDER, entityId: 'e1', payload: { req: { items: [{ id: 'c' }] } } });

    const ops = await listOutbox();
    expect(ops).toHaveLength(1);
    expect(ops[0].payload).toEqual({ req: { items: [{ id: 'c' }] } });
  });

  it('keeps arrangements for different estimates apart', async () => {
    await enqueueLatest({ ...ORDER, entityId: 'e1', payload: { req: { items: [{ id: 'a' }] } } });
    await enqueueLatest({ ...ORDER, entityId: 'e2', payload: { req: { items: [{ id: 'b' }] } } });

    expect((await listOutbox()).map((o) => o.entityId)).toEqual(['e1', 'e2']);
  });

  it('leaves other ops for the same entity alone', async () => {
    // An estimate can have a queued rename AND a queued arrangement; the arrangement supersedes
    // only arrangements. Keyed on entity + type, not on entityId alone.
    await enqueue({ entityId: 'e1', entity: 'estimate', type: 'update', payload: { name: 'X' }, deps: [] });
    await enqueueLatest({ ...ORDER, entityId: 'e1', payload: { req: { items: [{ id: 'a' }] } } });
    await enqueueLatest({ ...ORDER, entityId: 'e1', payload: { req: { items: [{ id: 'b' }] } } });

    const ops = await listOutbox();
    expect(ops.map((o) => o.entity)).toEqual(['estimate', 'estimateItemOrder']);
  });

  it('does not touch a blocked op', async () => {
    // A blocked op is waiting on a decision from the master (PRO or delete) and the sync banner is
    // asking about it. Dropping it silently would erase the question.
    await enqueueLatest({ ...ORDER, entityId: 'e1', payload: { req: { items: [{ id: 'a' }] } } });
    await blockOp('e1');

    await enqueueLatest({ ...ORDER, entityId: 'e1', payload: { req: { items: [{ id: 'b' }] } } });

    const ops = await listOutbox();
    expect(ops).toHaveLength(2);
    expect(ops.map((o) => o.status)).toEqual(['blocked', 'pending']);
  });

  it('re-counts the queue rather than assuming it grew', async () => {
    // It both adds and removes rows, so the sync banner's count has to come from a real count —
    // incrementing would make it drift up by one per drag and show work that is not queued.
    const { getSyncStatus } = await import('./outbox.ts');
    await enqueueLatest({ ...ORDER, entityId: 'e1', payload: { req: { items: [] } } });
    await enqueueLatest({ ...ORDER, entityId: 'e1', payload: { req: { items: [] } } });

    expect(getSyncStatus().pending).toBe(1);
  });
});

async function blockOp(entityId: string): Promise<void> {
  const { outboxDb } = await import('./db.ts');
  await outboxDb.ops.where('entityId').equals(entityId).modify({ status: 'blocked' });
}
