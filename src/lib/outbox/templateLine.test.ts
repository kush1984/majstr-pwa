import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearOutbox, enqueue, flushOutbox, getSyncStatus, listBlockedOps, registerOutboxHandler,
  releaseBlockedTemplateLines, setOutboxErrorClassifier,
} from './outbox.ts';
import { isTemplateLine } from './templateLine.ts';

/**
 * Review P0-5: a bundle applied offline queued its lines through the manual door, which refuses a
 * quantity of 0 — every one blocked for good, and «Надіслати» / PDF waited for a sync that never
 * came. Those lines now replay through the template-line door; the ones an older build left blocked
 * on a master's phone are released on the next start.
 */
beforeEach(async () => {
  await clearOutbox();
});

const line = (quantity: number, unit = 'M2') => ({
  estimateId: 'e1',
  req: { type: 'WORK', name: 'Ґрунтування', unit, quantity, unitPrice: 0 },
});

describe('isTemplateLine', () => {
  it('is a line with quantity 0 that is not a percentage', () => {
    expect(isTemplateLine(line(0).req)).toBe(true);
    expect(isTemplateLine(line(5).req)).toBe(false);
    expect(isTemplateLine(line(0, 'PERCENT').req)).toBe(false);
    expect(isTemplateLine(undefined)).toBe(false);
  });
});

describe('releaseBlockedTemplateLines', () => {
  it('releases the bundle lines an older build left blocked, and nothing else', async () => {
    // How an older build got here: the server refused the quantity of 0.
    setOutboxErrorClassifier(() => 'other');
    registerOutboxHandler('estimateItem', async () => { throw new Error('400 quantity must be greater than 0'); });
    registerOutboxHandler('client', async () => { throw new Error('400 bad client'); });
    await enqueue({ entityId: 'l1', entity: 'estimateItem', type: 'create', payload: line(0), deps: [] });
    await enqueue({ entityId: 'l2', entity: 'estimateItem', type: 'create', payload: line(0), deps: [] });
    await enqueue({ entityId: 'c1', entity: 'client', type: 'create', payload: {}, deps: [] });
    await flushOutbox();
    expect(getSyncStatus().blocked).toBe(3);

    const released = await releaseBlockedTemplateLines();

    expect(released).toBe(2);
    expect((await listBlockedOps()).map((op) => op.entityId)).toEqual(['c1']);
  });

  it('they then land — the replay takes the template-line door now', async () => {
    setOutboxErrorClassifier(() => 'other');
    registerOutboxHandler('estimateItem', async () => { throw new Error('400'); });
    await enqueue({ entityId: 'l1', entity: 'estimateItem', type: 'create', payload: line(0), deps: [] });
    await flushOutbox();
    await releaseBlockedTemplateLines();

    const landed: string[] = [];
    registerOutboxHandler('estimateItem', async (op) => { landed.push(op.entityId); });
    await flushOutbox();

    expect(landed).toEqual(['l1']);
    expect(getSyncStatus().blocked).toBe(0);
  });
});
