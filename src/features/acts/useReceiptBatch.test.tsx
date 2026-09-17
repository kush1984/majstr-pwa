import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import axios from 'axios';
import { clearOutbox, listOutbox } from '@/lib/outbox/outbox.ts';
import { initOutbox } from '@/lib/outbox/init.ts';
import { actsApi } from '@/api/acts.ts';
import { decodeQrFromFile } from '@/lib/qr.ts';
import { useReceiptBatch, type ReceiptBatchOutcome } from './useReceiptBatch.ts';
import type { ActReceiptOpPayload } from './offlineReceipts.ts';
import type { ActReceiptRecognizeResponse, WorkActReceiptResponse } from '@/api/types.ts';

/**
 * The two ways a batch of receipt photos used to write over the master (P-01, P-02).
 *
 * <p>Both are invisible from the outside: phase 2 runs for as long as a pile of photos takes to
 * read, the cards are on screen and editable the whole time, and everything it does is a PATCH
 * that looks perfectly ordinary in the network tab.</p>
 */

vi.mock('@/api/acts.ts', () => ({
  actsApi: {
    addReceipt: vi.fn(),
    readReceiptQr: vi.fn(),
    recognizeStoredReceipt: vi.fn(),
    updateReceipt: vi.fn(),
  },
}));
// The re-encode needs a canvas; jsdom has none, and what matters here is that a queued photo
// carries bytes at all — see offlineReceipts.test.ts.
vi.mock('@/lib/image.ts', () => ({ downscaleImage: vi.fn((f: File) => Promise.resolve(f)) }));
vi.mock('@/lib/qr.ts', () => ({
  BATCH_QR_BUDGET_MS: 100,
  decodeQrFromFile: vi.fn(),
  looksFiscal: vi.fn(() => true),
}));

const photo = (name: string) => new File(['bytes'], name, { type: 'image/jpeg' });

/** A receipt as the SERVER creates it: named «Чек №N», priced 0 = «not read yet», undated. */
const serverRow = (id: string, n: number): WorkActReceiptResponse => ({
  id,
  label: `Чек №${n}`,
  amount: 0,
  returnedAmount: 0,
  issuedAt: null,
  hasPhoto: true,
  itemized: false,
  sortOrder: 0,
});

function deferred<T>() {
  let settle: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    settle = r;
  });
  return { promise, resolve: (v: T) => settle(v) };
}

function renderBatch() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderHook(() => useReceiptBatch('a1', 'p1'), {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
  // The hook reads exactly one field back off the act; a whole WorkActResponse would say nothing.
  const seed = (receipts: WorkActReceiptResponse[]) => qc.setQueryData(['act', 'a1'], { receipts });
  return { ...view, seed };
}

// initOutbox is the only door to the entity handlers; its reconnect subscription is dropped at
// once, or an auto-flush would race the assertions. Nothing here ever flushes.
beforeAll(() => initOutbox(new QueryClient())());

beforeEach(async () => {
  vi.clearAllMocks();
  await clearOutbox();
  onlineManager.setOnline(true);
  vi.mocked(decodeQrFromFile).mockResolvedValue(null);
});

describe('useReceiptBatch', () => {
  it('does not write over a card the master priced while the batch was still reading', async () => {
    const r1 = serverRow('r1', 1);
    const r2 = serverRow('r2', 2);
    vi.mocked(actsApi.addReceipt).mockResolvedValueOnce(r1).mockResolvedValueOnce(r2);

    const slow = deferred<ActReceiptRecognizeResponse>();
    vi.mocked(actsApi.recognizeStoredReceipt)
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce({ recognized: true, label: 'АТБ', amount: 50, issuedAt: '2026-09-02', fiscalFn: null, fiscalId: null });

    const { result, seed } = renderBatch();
    seed([r1, r2]);

    let outcome: Promise<ReceiptBatchOutcome> | null = null;
    await act(async () => {
      outcome = result.current.run([photo('a.jpg'), photo('b.jpg')], {
        withAi: true,
        saveToPhotos: false,
      });
      await vi.waitFor(() => expect(actsApi.recognizeStoredReceipt).toHaveBeenCalledTimes(1));

      // Card 1 is on screen and reads «Чек №1 · 0 ₴», so he types what the paper says and records
      // the part he took back — all while the model is still busy with it.
      seed([{ ...r1, label: 'Епіцентр', amount: 990, returnedAmount: 40 }, r2]);
      slow.resolve({ recognized: true, label: 'Нова Пошта', amount: 12, issuedAt: '2026-09-01', fiscalFn: null, fiscalId: null });
      await outcome;
    });

    const [, id, req] = vi.mocked(actsApi.updateReceipt).mock.calls[0];
    expect(id).toBe('r1');
    // The read is a guess and his typing is a fact. It used to send «Нова Пошта» and 12 ₴ over the
    // top of both, and — by leaving returnedAmount out of a request that carries the whole row —
    // silently put the return back to 0.
    expect(req).toMatchObject({ label: 'Епіцентр', amount: 990, returnedAmount: 40 });
    // Per field, not all-or-nothing: he never touched the date, so the read still fills it.
    expect(req.issuedAt).toBe('2026-09-01');

    // And a card he left alone takes the read whole — the fix is not «never write».
    const [, id2, req2] = vi.mocked(actsApi.updateReceipt).mock.calls[1];
    expect(id2).toBe('r2');
    expect(req2).toMatchObject({ label: 'АТБ', amount: 50, issuedAt: '2026-09-02' });
  });

  it('corrects a photo that fell into the queue mid-batch locally, never through a 404', async () => {
    // The link dies on photo 3 of 5. addActReceipt quietly queues that one — every other photo of
    // the same batch uploads normally.
    vi.mocked(actsApi.addReceipt)
      .mockResolvedValueOnce(serverRow('r1', 1))
      .mockResolvedValueOnce(serverRow('r2', 2))
      .mockRejectedValueOnce(new axios.AxiosError('Network Error'))
      .mockResolvedValueOnce(serverRow('r4', 4))
      .mockResolvedValueOnce(serverRow('r5', 5));

    // Only the queued photo carries a fiscal QR — so the four uploaded rows go down the model rung
    // and the queued one is read locally, which is what makes the id assertions below sharp.
    vi.mocked(decodeQrFromFile).mockImplementation((file: File) =>
      Promise.resolve(file.name === 'c.jpg' ? 'fiscal-payload' : null),
    );
    vi.mocked(actsApi.readReceiptQr).mockResolvedValue({
      recognized: true, label: 'Епіцентр', amount: 250.5, issuedAt: '2026-09-01', fiscalFn: null, fiscalId: null,
    });
    vi.mocked(actsApi.recognizeStoredReceipt).mockResolvedValue({
      recognized: true, label: 'АТБ', amount: 100, issuedAt: null, fiscalFn: null, fiscalId: null,
    });

    const { result } = renderBatch();
    const files = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'].map(photo);

    let outcome: ReceiptBatchOutcome | null = null;
    await act(async () => {
      outcome = await result.current.run(files, { withAi: true, saveToPhotos: false });
    });

    // All five are receipts the master can see; one of them lives on his phone for now.
    expect(outcome).toMatchObject({ saved: 5, failed: 0 });
    const ops = await listOutbox();
    expect(ops).toHaveLength(1);
    const queuedId = ops[0].entityId;

    // The queued row's id is a client uuid the server has never seen. Both of these used to be
    // sent with it and answered 404 — swallowed as «nothing could be read», so the amount the QR
    // had already given us was dropped and the receipt stayed unpriced.
    expect(vi.mocked(actsApi.recognizeStoredReceipt).mock.calls.map(([, id]) => id))
      .toEqual(['r1', 'r2', 'r4', 'r5']);
    expect(vi.mocked(actsApi.updateReceipt).mock.calls.map(([, id]) => id))
      .toEqual(['r1', 'r2', 'r4', 'r5']);

    // Its sum went where the row actually is: into the pending create, ready to ride the replay.
    expect(ops[0].payload as ActReceiptOpPayload).toMatchObject({
      amount: 250.5, label: 'Епіцентр', issuedAt: '2026-09-01',
    });
    expect(queuedId).not.toBe('r4');
  });
});
