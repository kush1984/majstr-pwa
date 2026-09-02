import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { QueryClient, onlineManager } from '@tanstack/react-query';
import axios from 'axios';
import { clearOutbox, flushOutbox, listOutbox, outboxCount } from '@/lib/outbox/outbox.ts';
import { initOutbox } from '@/lib/outbox/init.ts';
import { actsApi } from '@/api/acts.ts';
import {
  ACT_RECEIPT_ENTITY, addActReceipt, dropQueuedReceipt, mergeQueuedReceipts, patchQueuedReceipt,
  queuedReceiptRow, type ActReceiptOpPayload, type QueuedActReceipt,
} from './offlineReceipts.ts';
import type { WorkActReceiptResponse } from '@/api/types.ts';

vi.mock('@/api/acts.ts', () => ({ actsApi: { addReceipt: vi.fn() } }));
// The re-encode needs a canvas; jsdom has none, and what this module owes the queue is that the
// photo went through it, not what it looks like afterwards.
vi.mock('@/lib/image.ts', () => ({ downscaleImage: vi.fn((f: File) => Promise.resolve(f)) }));

const photo = () => new File(['bytes'], 'receipt.jpg', { type: 'image/jpeg' });

/** The queued op of the one receipt in the outbox. */
async function queuedOp() {
  const [op] = await listOutbox();
  return { ...op, payload: op.payload as ActReceiptOpPayload };
}

// initOutbox is the only door to the entity handlers, and it also subscribes the queue to
// reconnects. That subscription is dropped immediately: an auto-flush racing the assertions would
// replay ops through a bare vi.fn() (which resolves, so the op is deleted as synced) and the test
// would be measuring its own scheduler. Every flush below is explicit.
beforeAll(() => initOutbox(new QueryClient())());

beforeEach(async () => {
  vi.clearAllMocks();
  await clearOutbox();
  onlineManager.setOnline(true);
});

describe('addActReceipt', () => {
  it('uploads straight away when there is a connection and queues nothing', async () => {
    vi.mocked(actsApi.addReceipt).mockResolvedValue({ id: 'r1' } as WorkActReceiptResponse);

    const row = await addActReceipt('a1', { id: 'u1', amount: 0, file: photo() });

    expect(row.id).toBe('r1');
    expect(await outboxCount()).toBe(0);
  });

  it('queues the photo when the phone is offline, and hands back a row to show right away', async () => {
    onlineManager.setOnline(false);

    const row = await addActReceipt('a1', { id: 'u1', amount: 0, file: photo(), saveToPhotos: true });

    expect(actsApi.addReceipt).not.toHaveBeenCalled();
    // Real to the master immediately: it has his photo, it counts as unpriced, and it is his to fix.
    expect(row).toMatchObject({ id: 'u1', amount: 0, returnedAmount: 0, hasPhoto: true, label: '' });

    const op = await queuedOp();
    expect(op.entity).toBe(ACT_RECEIPT_ENTITY);
    expect(op.type).toBe('create');
    expect(op.entityId).toBe('u1');
    expect(op.payload.actId).toBe('a1');
    expect(op.payload.saveToPhotos).toBe(true);
    // Bytes, not a Blob — see queuedFile.ts. A photo with no bytes is the one failure that loses
    // the receipt for good, since the paper is long gone by the time the queue drains.
    expect(op.payload.file.bytes.byteLength).toBeGreaterThan(0);
    expect(op.payload.file.mimeType).toBe('image/jpeg');
  });

  it('queues when the request dies on the wire, even though the device thought it was online', async () => {
    // The common shape of a building site: `navigator.onLine` is true on a bar of signal that
    // cannot carry a photo. Losing the receipt there is the same loss as losing it offline.
    vi.mocked(actsApi.addReceipt).mockRejectedValue(new axios.AxiosError('Network Error'));

    const row = await addActReceipt('a1', { id: 'u1', amount: 0, file: photo() });

    expect(row.id).toBe('u1');
    expect(await outboxCount()).toBe(1);
  });

  it('lets a real refusal through instead of queueing it — a signed act never accepts a receipt', async () => {
    // Queueing a 409 would retry it forever and tell the master his receipt is «on its way».
    const refusal = new axios.AxiosError('conflict');
    refusal.response = { status: 409, data: { code: 'WORK_ACT_SIGNED' } } as never;
    vi.mocked(actsApi.addReceipt).mockRejectedValue(refusal);

    await expect(addActReceipt('a1', { id: 'u1', amount: 0, file: photo() })).rejects.toThrow();
    expect(await outboxCount()).toBe(0);
  });
});

describe('the queued receipt handler', () => {
  it('replays under the SAME client uuid, so a retry cannot bill the material twice', async () => {
    // A duplicate here is duplicated money — in the act AND in the ADDENDUM it rolls up into.
    onlineManager.setOnline(false);
    await addActReceipt('a1', { id: 'u1', amount: 250.5, file: photo(), saveToPhotos: true });
    await patchQueuedReceipt('u1', { label: 'Епіцентр', amount: 250.5, issuedAt: '2026-09-01' });

    onlineManager.setOnline(true);
    vi.mocked(actsApi.addReceipt).mockResolvedValue({ id: 'u1' } as WorkActReceiptResponse);
    expect(await flushOutbox()).toEqual({ synced: 1, failed: 0 });

    const [actId, req] = vi.mocked(actsApi.addReceipt).mock.calls[0];
    expect(actId).toBe('a1');
    expect(req.id).toBe('u1');
    expect(req).toMatchObject({ label: 'Епіцентр', amount: 250.5, issuedAt: '2026-09-01', saveToPhotos: true });
    // The photo survives the round trip through IndexedDB as a File the multipart body can carry.
    expect(req.file).toBeInstanceOf(File);
    expect(req.file.type).toBe('image/jpeg');
    expect(await outboxCount()).toBe(0);
  });
});

describe('correcting a receipt that has not synced yet', () => {
  beforeEach(async () => {
    onlineManager.setOnline(false);
    await addActReceipt('a1', { id: 'u1', amount: 0, file: photo() });
  });

  it('writes the correction into the queued create rather than queueing a second op', async () => {
    // There is no server row to PATCH, and a correction made before the receipt lands is not a
    // second fact about it — it is what the receipt always was, as far as the server will know.
    expect(await patchQueuedReceipt('u1', { label: 'Нова Пошта', amount: 420, issuedAt: null })).toBe(true);

    expect(await outboxCount()).toBe(1);
    const op = await queuedOp();
    expect(op.payload).toMatchObject({ label: 'Нова Пошта', amount: 420, issuedAt: null });
    expect(op.payload.file.bytes.byteLength).toBeGreaterThan(0); // the photo is not touched
  });

  it('deleting it drops the op — there is nothing on the server to ask about', async () => {
    expect(await dropQueuedReceipt('u1')).toBe(true);
    expect(await outboxCount()).toBe(0);
  });

  it('says so when the queue drained first, so the caller can fall back to the server row', async () => {
    await clearOutbox();
    expect(await patchQueuedReceipt('u1', { label: 'x', amount: 1, issuedAt: null })).toBe(false);
    expect(await dropQueuedReceipt('u1')).toBe(false);
  });
});

describe('mergeQueuedReceipts', () => {
  const stored = (id: string, over: Partial<WorkActReceiptResponse> = {}): WorkActReceiptResponse => ({
    id, label: `Чек №${id}`, amount: 100, returnedAmount: 0, issuedAt: '2026-08-01',
    hasPhoto: true, itemized: false, sortOrder: 0, ...over,
  });
  const pending = (id: string): QueuedActReceipt => ({
    id,
    payload: { actId: 'a1', amount: 0, file: { bytes: new ArrayBuffer(4), fileName: 'r.jpg', mimeType: 'image/jpeg' } },
    file: photo(),
  });

  it('puts what the phone is still carrying first — the server sorts undated newest-first too', () => {
    const merged = mergeQueuedReceipts([stored('r1')], new Map([['u1', pending('u1')]]));
    expect(merged.map((r) => r.id)).toEqual(['u1', 'r1']);
  });

  it('drops the queued copy the moment the real row arrives, so nothing is ever shown twice', () => {
    // The window this closes: a reconnect refetch can land before the flush drains, or after it.
    const merged = mergeQueuedReceipts([stored('u1', { label: 'Чек №1' })], new Map([['u1', pending('u1')]]));
    expect(merged).toHaveLength(1);
    expect(merged[0].label).toBe('Чек №1');
  });

  it('returns the stored list untouched when the queue is empty', () => {
    const list = [stored('r1')];
    expect(mergeQueuedReceipts(list, new Map())).toBe(list);
  });
});

describe('queuedReceiptRow', () => {
  it('is deliberately unnamed — «Чек №N» counts the act’s receipts and only the server can', () => {
    // A device holding three unsent photos would name every one of them «Чек №1».
    const row = queuedReceiptRow('u1', { actId: 'a1', amount: 0, file: { bytes: new ArrayBuffer(2), fileName: 'r.jpg', mimeType: 'image/jpeg' } });
    expect(row.label).toBe('');
    expect(row.returnedAmount).toBe(0); // not on the create endpoint at all
  });
});
