import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ProjectReceiptsPage } from './ProjectReceiptsPage.tsx';
import { toast } from '@/hooks/useToast.ts';
import type { ProjectReceiptResponse, ProjectReceiptsResponse } from '@/api/types.ts';

const holder = vi.hoisted(() => ({
  list: null as ProjectReceiptsResponse | null,
  isError: false,
  error: undefined as Error | undefined,
}));
const updateMutate = vi.hoisted(() => vi.fn());
const updateAsync = vi.hoisted(() => vi.fn());
const removeMutate = vi.hoisted(() => vi.fn());
const refetch = vi.hoisted(() => vi.fn());
vi.mock('./useProjectReceipts.ts', () => ({
  useProjectReceipts: () => ({
    data: holder.list,
    isLoading: false,
    isError: holder.isError,
    error: holder.error,
    refetch,
  }),
  useUpdateProjectReceipt: () => ({
    mutate: updateMutate,
    mutateAsync: updateAsync,
    isPending: false,
  }),
  useDeleteProjectReceipt: () => ({ mutate: removeMutate, isPending: false }),
}));

const batchRun = vi.hoisted(() => vi.fn());
vi.mock('./useProjectReceiptBatch.ts', () => ({
  useProjectReceiptBatch: () => ({ progress: null, run: batchRun, cancel: vi.fn() }),
}));

// The photo is fetched with a bearer token, which no test has — stub the transport, not the view.
vi.mock('@/api/photos.ts', () => ({
  photosApi: {
    fetchBlob: vi.fn().mockResolvedValue(new Blob([''])),
    fetchBlobUrl: vi.fn().mockResolvedValue('blob:receipt'),
  },
}));

const readQr = vi.hoisted(() => vi.fn());
const recognizeStored = vi.hoisted(() => vi.fn());
vi.mock('@/api/projectReceipts.ts', () => ({
  projectReceiptsApi: {
    fileUrl: (projectId: string, receiptId: string) =>
      `/api/projects/${projectId}/receipts/${receiptId}/file`,
    readQr,
    recognizeStored,
  },
}));

// The canvas and jsqr are the decoder's own business (and its own test's) — here only the answer
// matters: does this photo carry a fiscal payload or not.
vi.mock('@/lib/qr.ts', async (orig) => ({
  ...(await orig<typeof import('@/lib/qr.ts')>()),
  decodeQrFromFile: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@/hooks/useToast.ts', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useToast.ts')>()),
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

function receipt(over: Partial<ProjectReceiptResponse> = {}): ProjectReceiptResponse {
  return {
    id: 'r1',
    label: 'Епіцентр',
    amount: 1250,
    issuedAt: '2026-09-01',
    hasPhoto: false,
    reimbursable: true,
    sortOrder: 0,
    ...over,
  };
}

function seed(items: ProjectReceiptResponse[], over: Partial<ProjectReceiptsResponse> = {}) {
  holder.list = {
    items,
    reimbursableTotal: items.filter((r) => r.reimbursable).reduce((s, r) => s + r.amount, 0),
    ownTotal: items.filter((r) => !r.reimbursable).reduce((s, r) => s + r.amount, 0),
    unpricedCount: items.filter((r) => r.amount <= 0).length,
    ...over,
  };
}

function renderPage(from?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/receipts/:projectId', element: <ProjectReceiptsPage /> },
      { path: '*', element: <div>інший екран</div> },
    ],
    { initialEntries: [{ pathname: '/receipts/p1', state: from ? { from } : null }] },
  );
  const view = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router };
}

beforeEach(() => {
  holder.list = null;
  holder.isError = false;
  holder.error = undefined;
  updateMutate.mockClear();
  updateAsync.mockClear();
  removeMutate.mockClear();
  batchRun.mockClear();
  refetch.mockClear();
  readQr.mockReset();
  recognizeStored.mockReset();
  vi.mocked(toast.info).mockClear();
  vi.mocked(toast.error).mockClear();
});

// Restoring the flag re-renders whatever is still mounted — inside act(), or React warns.
afterEach(() => act(() => onlineManager.setOnline(true)));

describe('ProjectReceiptsPage', () => {
  it('leads with what the client owes back, and hides «Мої витрати» until there is one', () => {
    seed([receipt()]);
    renderPage();

    expect(screen.getByText('Клієнт відшкодовує')).toBeTruthy();
    // A permanent 0 ₴ «Мої витрати» invites exactly the pondering this screen removes.
    expect(screen.queryByText('Мої витрати')).toBeNull();
  });

  it('shows «Мої витрати» once a receipt is filed as one', () => {
    seed([receipt(), receipt({ id: 'r2', label: 'Свій', reimbursable: false, amount: 300 })]);
    renderPage();

    expect(screen.getByText('Мої витрати')).toBeTruthy();
  });

  /**
   * The one economic decision on the screen, and the one that can silently destroy data: the server
   * requires `label` and `amount` on a PATCH, so a toggle that sent only the flag would erase the
   * text the master typed off the paper.
   */
  it('sends the row’s whole text state when «це моя витрата» is tapped', () => {
    seed([receipt()]);
    renderPage();

    // The ↩ is the badge's own; the totals card carries the same words plus an (i) button.
    fireEvent.click(screen.getByRole('button', { name: /↩ Клієнт відшкодовує/ }));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0][0]).toEqual({
      receiptId: 'r1',
      req: { label: 'Епіцентр', amount: 1250, issuedAt: '2026-09-01', reimbursable: false },
    });
    // `fiscalFn`/`fiscalId` are deliberately absent: the server never clears them on an ordinary
    // PATCH, and `reimbursable` says nothing about the paper's identity.
    expect(updateMutate.mock.calls[0][0].req).not.toHaveProperty('fiscalFn');
  });

  it('flips back to reimbursable from an own-cost receipt', () => {
    seed([receipt({ reimbursable: false })]);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Моя витрата/ }));

    expect(updateMutate.mock.calls[0][0].req.reimbursable).toBe(true);
  });

  /** The master's own ask: «не тільки камеру відкривало, а давало також вибрати з галереї декілька». */
  it('offers the camera AND a gallery pick that takes several photos', () => {
    seed([receipt()]);
    const { container } = renderPage();

    const inputs = [...container.querySelectorAll('input[type="file"]')];
    expect(inputs).toHaveLength(2);
    expect(inputs[0].getAttribute('capture')).toBe('environment');
    expect(inputs[0].hasAttribute('multiple')).toBe(false);
    // The gallery one is the whole point — a master photographs the day's pile and adds it at once.
    expect(inputs[1].hasAttribute('multiple')).toBe(true);
    expect(inputs[1].getAttribute('accept')).toBe('image/*');
  });

  /**
   * An object receipt has NO outbox, unlike an act's. Saying so before he tries beats a pile of
   * photos that looked saved and are gone.
   */
  it('refuses to add offline, and says why instead of queueing', () => {
    seed([receipt()]);
    act(() => onlineManager.setOnline(false));
    renderPage();

    expect(screen.getByRole('button', { name: /Зняти фото/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /Вибрати з галереї/ }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByText(/потрібен зв'язок/)).toBeTruthy();
  });

  it('warns about an unpriced receipt without gating anything on it', () => {
    seed([receipt({ amount: 0 })]);
    renderPage();

    expect(screen.getByText(/Чеків без суми: 1/)).toBeTruthy();
    expect(screen.getByText('без суми')).toBeTruthy();
    // Amount 0 is a legal saved state here — an object has no signature for it to block.
    expect(screen.getByRole('button', { name: /Зняти фото/ }).hasAttribute('disabled')).toBe(false);
  });

  it('flags a duplicate as a warning, never as a refused save', () => {
    seed([receipt({
      duplicateOf: { kind: 'OBJECT', id: 'r0', label: 'Епіцентр (перший)' },
    })]);
    renderPage();

    // It NAMES the twin (B-04): «схоже на дублікат» about a list of forty receipts is a warning a
    // master learns to ignore, and there is nothing in it to act on.
    expect(screen.getByText(/дублікат/)).toBeTruthy();
    expect(screen.getByText(/Епіцентр \(перший\)/)).toBeTruthy();
  });

  /**
   * The pair B-04 exists for: the same slip photographed at the till AND attached to an act. Before
   * it, the act table carried no printed identity at all, so this was the one duplicate nothing
   * could see — and the only one that bills the client twice.
   */
  it('says WHICH act already holds the same paper', () => {
    seed([receipt({
      duplicateOf: { kind: 'ACT', id: 'ar1', label: 'Цвяхи', actNumber: '7' },
    })]);
    renderPage();

    expect(screen.getByText(/уже в акті № 7/)).toBeTruthy();
  });

  /**
   * A signed act took this money into «За договором», so the object's receivable lets go of it —
   * and the row says so rather than vanishing, or the master is left looking for a receipt he
   * definitely photographed.
   */
  it('says which act billed a receipt that has left the receivable', () => {
    seed([receipt({ billedOnActId: 'a1', billedOnActNumber: '7' })], { reimbursableTotal: 0 });
    renderPage();

    expect(screen.getByText(/Списано актом № 7/)).toBeTruthy();
    expect(screen.getByText('Епіцентр')).toBeTruthy();
  });

  it('says the receipts could not be loaded instead of claiming there are none', () => {
    // «Чеків ще немає» on a screen whose whole point is proof the master is owed money reads as the
    // receipts having been LOST. A failed fetch with nothing cached is an outage, and says so.
    holder.isError = true;
    holder.error = new Error('boom');
    renderPage();

    expect(screen.getByText('Сервіс тимчасово недоступний')).toBeTruthy();
    expect(screen.queryByText('Чеків ще немає')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Спробувати знову' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('keeps the cached receipts on screen when a background refetch fails', () => {
    seed([receipt()]);
    holder.isError = true;
    holder.error = new Error('boom');
    renderPage();

    expect(screen.getByText('Епіцентр')).toBeTruthy();
    expect(screen.queryByText('Сервіс тимчасово недоступний')).toBeNull();
  });

  it('goes back to the screen that opened it, not always to the object', () => {
    seed([receipt()]);
    const { router } = renderPage('/shopping/p1');

    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));

    expect(router.state.location.pathname).toBe('/shopping/p1');
  });

  it('falls back to the object when there is no state to go back to', () => {
    seed([receipt()]);
    const { router } = renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));

    expect(router.state.location.pathname).toBe('/projects/p1');
  });

  /**
   * A read that found the shop and the date but not the total is PARTIAL, not a failure. It used to
   * be thrown away whole, under «не вдалося розпізнати», leaving the master to retype off the paper
   * what we had just read off it. Same split as the edit form's own reader.
   */
  it('keeps a label-only read instead of discarding it as a failure', async () => {
    seed([receipt({ amount: 0, label: 'Чек №1', issuedAt: null, hasPhoto: true })]);
    recognizeStored.mockResolvedValue({
      recognized: true,
      label: 'Епіцентр',
      amount: null,
      issuedAt: '2026-09-01',
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Розпізнати/ }));

    await vi.waitFor(() => expect(updateAsync).toHaveBeenCalled());
    expect(updateAsync.mock.calls[0][0].req).toMatchObject({
      label: 'Епіцентр',
      // The paper never gave up a total, so the row keeps the one it had — 0 is a legal saved state.
      amount: 0,
      issuedAt: '2026-09-01',
    });
    // Said AFTER the save, so the card he is looking at already carries the label and the date.
    expect(vi.mocked(toast.info).mock.calls.map(([m]) => m)).toContain(
      'Розпізнано не все — перевірте і доповніть вручну.',
    );
  });

  it('still says nothing could be read when nothing was', async () => {
    seed([receipt({ amount: 0, label: 'Чек №1', hasPhoto: true })]);
    recognizeStored.mockResolvedValue({
      recognized: false,
      label: null,
      amount: null,
      issuedAt: null,
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Розпізнати/ }));

    await vi.waitFor(() =>
      expect(vi.mocked(toast.info).mock.calls.map(([m]) => m)).toContain(
        'Не вдалося розпізнати чек — впишіть суму вручну.',
      ),
    );
    expect(updateAsync).not.toHaveBeenCalled();
  });

  it('teaches the default on an empty screen', () => {
    seed([]);
    renderPage();

    expect(screen.getByText('Чеків ще немає')).toBeTruthy();
    expect(screen.getByText(/клієнт вам поверне/)).toBeTruthy();
  });
});
