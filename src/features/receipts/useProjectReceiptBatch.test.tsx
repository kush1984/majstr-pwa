import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { projectReceiptsApi } from '@/api/projectReceipts.ts';
import { decodeQrFromFile } from '@/lib/qr.ts';
import { useProjectReceiptBatch, type ProjectReceiptBatchOutcome } from './useProjectReceiptBatch.ts';
import type { ProjectReceiptResponse, ReceiptRecognizeResponse } from '@/api/types.ts';

/**
 * The object batch has the act batch's P-01 bug for the same reason: an object PATCH also carries
 * the row's whole text state, and phase 2 lasts as long as the pile does. (It has no P-02 twin —
 * an object receipt cannot be queued, so this batch refuses up front when there is no connection.)
 */

vi.mock('@/api/projectReceipts.ts', () => ({
  projectReceiptsApi: {
    add: vi.fn(),
    readQr: vi.fn(),
    recognizeStored: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock('@/lib/qr.ts', () => ({
  BATCH_QR_BUDGET_MS: 100,
  decodeQrFromFile: vi.fn(),
  looksFiscal: vi.fn(() => true),
}));

const photo = (name: string) => new File(['bytes'], name, { type: 'image/jpeg' });

/** A receipt as the SERVER creates it: named «Чек №N», priced 0 = «not read yet», undated. */
const serverRow = (id: string, n: number) =>
  ({ id, label: `Чек №${n}`, amount: 0, issuedAt: null }) as ProjectReceiptResponse;

function deferred<T>() {
  let settle: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    settle = r;
  });
  return { promise, resolve: (v: T) => settle(v) };
}

function renderBatch() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderHook(() => useProjectReceiptBatch('p1'), {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
  const seed = (items: ProjectReceiptResponse[]) =>
    qc.setQueryData(['project-receipts', 'p1'], { items });
  return { ...view, seed };
}

beforeEach(() => {
  vi.clearAllMocks();
  onlineManager.setOnline(true);
  vi.mocked(decodeQrFromFile).mockResolvedValue(null);
});

describe('useProjectReceiptBatch', () => {
  it('does not write over a card the master priced while the batch was still reading', async () => {
    const r1 = serverRow('r1', 1);
    const r2 = serverRow('r2', 2);
    vi.mocked(projectReceiptsApi.add).mockResolvedValueOnce(r1).mockResolvedValueOnce(r2);

    const slow = deferred<ReceiptRecognizeResponse>();
    vi.mocked(projectReceiptsApi.recognizeStored)
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce({
        recognized: true, label: 'АТБ', amount: 50, issuedAt: '2026-09-02',
        fiscalFn: null, fiscalId: null,
      });

    const { result, seed } = renderBatch();
    seed([r1, r2]);

    let outcome: Promise<ProjectReceiptBatchOutcome> | null = null;
    await act(async () => {
      outcome = result.current.run([photo('a.jpg'), photo('b.jpg')], { withAi: true });
      await vi.waitFor(() => expect(projectReceiptsApi.recognizeStored).toHaveBeenCalledTimes(1));

      // Card 1 reads «Чек №1 · 0 ₴», so he types what the paper says while the model is still on it.
      seed([{ ...r1, label: 'Епіцентр', amount: 990 }, r2]);
      slow.resolve({
        recognized: true, label: 'Нова Пошта', amount: 12, issuedAt: '2026-09-01',
        fiscalFn: '4000', fiscalId: '77',
      });
      await outcome;
    });

    const [, id, req] = vi.mocked(projectReceiptsApi.update).mock.calls[0];
    expect(id).toBe('r1');
    // His typing is a fact, the read is a guess — it used to send both of these over the top.
    expect(req).toMatchObject({ label: 'Епіцентр', amount: 990 });
    // Per field: the date he never typed, and the paper's identity he cannot type at all, still
    // come from the read — the fiscal pair is what lets the server flag a duplicate later.
    expect(req).toMatchObject({ issuedAt: '2026-09-01', fiscalFn: '4000', fiscalId: '77' });
  });
});
