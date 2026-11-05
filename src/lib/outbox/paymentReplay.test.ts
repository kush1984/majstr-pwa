import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { clearOutbox, enqueue, flushOutbox, outboxCount } from './outbox.ts';
import { initOutbox } from './init.ts';
import { paymentsApi } from '@/api/payments.ts';
import { tokens } from '@/lib/tokens.ts';
import { aSessionToken } from '@/test/factories.ts';

/**
 * The money the master typed with no signal actually reaches the server on reconnect (review
 * P-33). `payment-receipt` had no handler for as long as the hook queued against it — so the op
 * was skipped by every flush and the screen went back to the server's untouched numbers at the
 * next invalidate.
 *
 * <p>Asserts the replay end to end through the real registry: the op the hook enqueues, replayed
 * by the handlers `initOutbox` installs, reaches the API with the op's own entityId as the
 * idempotency key.</p>
 */
vi.mock('@/api/payments.ts', () => ({
  paymentsApi: {
    addReceipt: vi.fn().mockResolvedValue([]),
    editReceipt: vi.fn().mockResolvedValue({}),
    removeReceipt: vi.fn().mockResolvedValue(undefined),
  },
}));

const OBJECT = 'obj-1';
let stop: () => void;

beforeEach(async () => {
  tokens.set(aSessionToken(), 'r');
  await clearOutbox();
  vi.clearAllMocks();
  stop?.();
  stop = initOutbox(new QueryClient());
});

describe('queued object payments replay', () => {
  it('sends received money authored offline, then the edit and the delete of it', async () => {
    const req = { label: 'Своє', amount: 20_000, receivedAt: '2026-09-25' };
    await enqueue({
      entityId: 'rec-1', entity: 'payment-receipt', type: 'create',
      payload: { objectId: OBJECT, req }, deps: [OBJECT],
    });
    await enqueue({
      entityId: 'rec-1', entity: 'payment-receipt', type: 'update',
      payload: { objectId: OBJECT, req: { ...req, amount: 18_000 } }, deps: [OBJECT],
    });
    await enqueue({
      entityId: 'rec-2', entity: 'payment-receipt', type: 'delete',
      payload: { objectId: OBJECT }, deps: [OBJECT],
    });

    expect(await flushOutbox()).toEqual({ synced: 3, failed: 0, blocked: 0 });
    expect(paymentsApi.addReceipt).toHaveBeenCalledWith(OBJECT, req, 'rec-1');
    expect(paymentsApi.editReceipt).toHaveBeenCalledWith(
      OBJECT, 'rec-1', { ...req, amount: 18_000 },
    );
    expect(paymentsApi.removeReceipt).toHaveBeenCalledWith(OBJECT, 'rec-2');
    expect(await outboxCount()).toBe(0);
  });

  it('discards a plan stage an older build queued — the plan is gone — and still sends the money', async () => {
    await enqueue({
      entityId: 'rec-1', entity: 'payment-receipt', type: 'create',
      payload: { objectId: OBJECT, req: { label: 'Аванс', amount: 5_000, receivedAt: '2026-09-25' } },
      deps: [OBJECT, 'pay-1'],
    });
    await enqueue({
      entityId: 'pay-1', entity: 'project-payment', type: 'create',
      payload: { objectId: OBJECT, req: { amount: 5_000, purpose: 'Етап 1' } }, deps: [OBJECT],
    });

    expect(await flushOutbox()).toEqual({ synced: 2, failed: 0, blocked: 0 });
    expect(paymentsApi.addReceipt).toHaveBeenCalledTimes(1);
    expect(await outboxCount()).toBe(0);
  });
});
