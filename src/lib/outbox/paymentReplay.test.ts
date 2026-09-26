import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { clearOutbox, enqueue, flushOutbox, outboxCount } from './outbox.ts';
import { initOutbox } from './init.ts';
import { paymentsApi } from '@/api/payments.ts';

/**
 * The money the master typed with no signal actually reaches the server on reconnect (review
 * P-33). Both hooks queued against `project-payment` / `payment-receipt` for as long as they have
 * existed, and `init.ts` registered neither — so the op was skipped by every flush and the screen
 * went back to the server's untouched numbers at the next invalidate.
 *
 * <p>Asserts the replay end to end through the real registry: the op that `useAddPayment` /
 * `useAddReceipt` enqueue, replayed by the handlers `initOutbox` installs, reaches the API with
 * the op's own entityId as the idempotency key.</p>
 */
vi.mock('@/api/payments.ts', () => ({
  paymentsApi: {
    add: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue(undefined),
    addReceipt: vi.fn().mockResolvedValue([]),
    editReceipt: vi.fn().mockResolvedValue({}),
    removeReceipt: vi.fn().mockResolvedValue(undefined),
  },
}));

const OBJECT = 'obj-1';
let stop: () => void;

beforeEach(async () => {
  await clearOutbox();
  vi.clearAllMocks();
  stop?.();
  stop = initOutbox(new QueryClient());
});

describe('queued object payments replay', () => {
  it('sends a plan stage authored offline, under its own entity uuid', async () => {
    const req = { amount: 20_000, purpose: 'Аванс', dueDate: null, nextStage: null };
    await enqueue({
      entityId: 'pay-1', entity: 'project-payment', type: 'create',
      payload: { objectId: OBJECT, req }, deps: [OBJECT],
    });

    expect(await flushOutbox()).toEqual({ synced: 1, failed: 0 });
    expect(paymentsApi.add).toHaveBeenCalledWith(OBJECT, req, 'pay-1');
    expect(await outboxCount()).toBe(0);
  });

  it('sends received money authored offline, then the edit and the delete of it', async () => {
    const req = { planPaymentId: null, label: 'Своє', amount: 20_000, receivedAt: '2026-09-25' };
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

    expect(await flushOutbox()).toEqual({ synced: 3, failed: 0 });
    expect(paymentsApi.addReceipt).toHaveBeenCalledWith(OBJECT, req, 'rec-1');
    expect(paymentsApi.editReceipt).toHaveBeenCalledWith(
      OBJECT, 'rec-1', { ...req, amount: 18_000 },
    );
    expect(paymentsApi.removeReceipt).toHaveBeenCalledWith(OBJECT, 'rec-2');
    expect(await outboxCount()).toBe(0);
  });

  it('holds a receipt back until the stage it closes has landed', async () => {
    const order: string[] = [];
    vi.mocked(paymentsApi.add).mockImplementation(async () => { order.push('stage'); return {} as never; });
    vi.mocked(paymentsApi.addReceipt).mockImplementation(async () => { order.push('receipt'); return []; });

    // Enqueued receipt-first on purpose: only the dep can put them in the right order.
    await enqueue({
      entityId: 'rec-1', entity: 'payment-receipt', type: 'create',
      payload: { objectId: OBJECT, req: { planPaymentId: 'pay-1', amount: 5_000, receivedAt: '2026-09-25' } },
      deps: [OBJECT, 'pay-1'],
    });
    await enqueue({
      entityId: 'pay-1', entity: 'project-payment', type: 'create',
      payload: { objectId: OBJECT, req: { amount: 5_000, purpose: 'Етап 1' } }, deps: [OBJECT],
    });

    expect(await flushOutbox()).toEqual({ synced: 2, failed: 0 });
    expect(order).toEqual(['stage', 'receipt']);
  });
});
