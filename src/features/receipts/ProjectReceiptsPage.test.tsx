import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ProjectReceiptsPage } from './ProjectReceiptsPage.tsx';
import type { ProjectReceiptResponse, ProjectReceiptsResponse } from '@/api/types.ts';

const holder = vi.hoisted(() => ({ list: null as ProjectReceiptsResponse | null }));
const updateMutate = vi.hoisted(() => vi.fn());
const updateAsync = vi.hoisted(() => vi.fn());
const removeMutate = vi.hoisted(() => vi.fn());
vi.mock('./useProjectReceipts.ts', () => ({
  useProjectReceipts: () => ({ data: holder.list, isLoading: false, isError: false }),
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

function receipt(over: Partial<ProjectReceiptResponse> = {}): ProjectReceiptResponse {
  return {
    id: 'r1',
    label: 'Епіцентр',
    amount: 1250,
    issuedAt: '2026-09-01',
    hasPhoto: false,
    reimbursable: true,
    duplicate: false,
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
  updateMutate.mockClear();
  updateAsync.mockClear();
  removeMutate.mockClear();
  batchRun.mockClear();
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
    seed([receipt({ duplicate: true })]);
    renderPage();

    expect(screen.getByText(/дублікат/)).toBeTruthy();
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

  it('teaches the default on an empty screen', () => {
    seed([]);
    renderPage();

    expect(screen.getByText('Чеків ще немає')).toBeTruthy();
    expect(screen.getByText(/клієнт вам поверне/)).toBeTruthy();
  });
});
