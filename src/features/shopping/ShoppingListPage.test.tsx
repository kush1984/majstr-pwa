import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ShoppingListPage } from './ShoppingListPage.tsx';
import type { ShoppingListItemResponse, ShoppingListResponse } from '@/api/types.ts';

const holder = vi.hoisted(() => ({ list: null as ShoppingListResponse | null }));
const updateMutate = vi.hoisted(() => vi.fn());
const clearMutate = vi.hoisted(() => vi.fn());
vi.mock('./useShoppingList.ts', () => ({
  useShoppingList: () => ({ data: holder.list, isLoading: false, isError: false }),
  useShoppingActions: () => ({
    add: { mutate: vi.fn() },
    update: { mutate: updateMutate },
    remove: { mutate: vi.fn() },
    clearBought: { mutate: clearMutate },
  }),
}));

const fetchPdfBlob = vi.hoisted(() => vi.fn());
const sharePdf = vi.hoisted(() => vi.fn());
vi.mock('@/api/shopping.ts', () => ({ shoppingApi: { fetchPdfBlob } }));
vi.mock('@/lib/sharePdf.ts', () => ({ sharePdf }));

function item(over: Partial<ShoppingListItemResponse>): ShoppingListItemResponse {
  return {
    id: 'i1',
    materialId: null,
    name: 'Профіль CD',
    unit: 'PIECE',
    quantity: 12,
    bought: false,
    boughtAt: null,
    edited: false,
    suggestedQuantity: null,
    topUp: false,
    source: 'CALCULATOR',
    sourceEstimateId: null,
    note: null,
    sortOrder: 0,
    ...over,
  };
}

function seed(
  items: ShoppingListItemResponse[],
  archivedAt: string | null = null,
  sourceEstimateUnsigned = false,
) {
  holder.list = {
    id: 'l1',
    projectId: 'p1',
    projectName: 'Квартира',
    archivedAt,
    totalCount: items.length,
    boughtCount: items.filter((i) => i.bought).length,
    sourceEstimateUnsigned,
    items,
  };
}

function renderPage(from?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/shopping/:projectId', element: <ShoppingListPage /> },
      { path: '*', element: <div>інший екран</div> },
    ],
    { initialEntries: [{ pathname: '/shopping/p1', state: from ? { from } : null }] },
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
  clearMutate.mockClear();
  fetchPdfBlob.mockReset();
  fetchPdfBlob.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
  sharePdf.mockReset();
  sharePdf.mockResolvedValue(undefined);
});

// Restoring the flag re-renders whatever is still mounted — inside act(), or React warns.
afterEach(() => act(() => onlineManager.setOnline(true)));

describe('ShoppingListPage', () => {
  it('shows the bought rows without being asked, and folds them on the group row', () => {
    seed([item({ id: 'a' }), item({ id: 'b', name: 'Профіль UD', bought: true, sortOrder: 1 })]);
    renderPage();

    // Folded by default they read as gone — the master could not check what is in the trolley.
    expect(screen.getByText('Профіль CD')).toBeTruthy();
    expect(screen.getByText('Профіль UD')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Куплено · 1/ }));
    expect(screen.queryByText('Профіль UD')).toBeNull();
  });

  it('goes back to the screen that opened the list, not always to the object', () => {
    seed([item({ id: 'a' })]);
    const { router } = renderPage('/estimates/e1/materials');

    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(router.state.location.pathname).toBe('/estimates/e1/materials');
  });

  it('falls back to the object when it was opened cold, without a referrer', () => {
    seed([item({ id: 'a' })]);
    const { router } = renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(router.state.location.pathname).toBe('/projects/p1');
  });

  it('ticks a row from the checkbox, not the row body', () => {
    seed([item({ id: 'a' })]);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Профіль CD' }));
    expect(updateMutate).toHaveBeenCalledWith({ itemId: 'a', req: { bought: true } });
  });

  it('does NOT offer a receipt step — the button is parked until masters ask for it', () => {
    // Bought rows present, which is exactly when the button used to appear. The receipts screen and
    // its endpoints all still exist; only this entry point is withdrawn, pending real demand.
    seed([item({ id: 'a', bought: true }), item({ id: 'b', sortOrder: 1 })]);
    renderPage();

    expect(screen.queryByText(/Додати чек/)).toBeNull();
    // The tidy-up action is NOT part of that removal — it must survive on its own.
    expect(screen.getByText('Прибрати куплені')).toBeTruthy();
  });

  it('sends the list to the client as a PDF through the phone share sheet (V129)', async () => {
    seed([item({ id: 'a' })]);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Поділитись списком/ }));

    await waitFor(() => expect(sharePdf).toHaveBeenCalled());
    expect(fetchPdfBlob).toHaveBeenCalledWith('p1');
    // The file name is what the client sees in Viber — not «blob» or the object's uuid.
    expect(sharePdf.mock.calls[0][1]).toBe('Список покупок.pdf');
  });

  it('says the share needs a connection instead of failing at the merchant', () => {
    onlineManager.setOnline(false);
    seed([item({ id: 'a' })]);
    renderPage();

    // Disabled and titled, not hidden: the action exists, it just can't run in a basement.
    const button = screen.getByRole('button', { name: /Поділитись списком/ });
    expect(button.hasAttribute('disabled')).toBe(true);
    // Everything else on the screen still writes — only this one row is online-only.
    fireEvent.click(screen.getByRole('button', { name: 'Профіль CD' }));
    expect(updateMutate).toHaveBeenCalled();
  });

  it('locks every write on a finished object', () => {
    seed(
      [item({ id: 'a' }), item({ id: 'b', name: 'Профіль UD', bought: true, sortOrder: 1 })],
      '2026-09-01T00:00:00Z',
    );
    renderPage();

    expect(screen.getByText(/список в архіві/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Профіль CD' }));
    expect(updateMutate).not.toHaveBeenCalled();
    expect(screen.queryByText('Прибрати куплені')).toBeNull();
  });

  it('invites the first row when the list is empty', () => {
    seed([]);
    renderPage();
    expect(screen.getByText('Список порожній')).toBeTruthy();
  });

  it('shows the master what the recalculation wanted instead of dropping it', () => {
    seed([item({ quantity: 9, edited: true, suggestedQuantity: 20 })]);
    renderPage();

    // His 9 still stands on the row; the 20 is beside it, as an offer rather than a change.
    expect(screen.getByText(/Перерахунок дає 20/)).toBeTruthy();
    fireEvent.click(screen.getByText('Взяти нове'));

    expect(updateMutate).toHaveBeenCalledWith({ itemId: 'i1', req: { suggestion: 'ACCEPT' } });
  });

  it('lets the master keep his own number, which also answers the offer', () => {
    seed([item({ quantity: 9, edited: true, suggestedQuantity: 20 })]);
    renderPage();
    fireEvent.click(screen.getByText('Лишити своє'));

    expect(updateMutate).toHaveBeenCalledWith({ itemId: 'i1', req: { suggestion: 'KEEP_MINE' } });
  });

  it('says a delta row is a top-up, so a small number beside a bought one is not read as an error', () => {
    seed([
      item({ id: 'a', quantity: 12, bought: true }),
      item({ id: 'b', quantity: 6, topUp: true, sortOrder: 1 }),
    ]);
    renderPage();

    expect(screen.getByText('ще')).toBeTruthy();
    // And why it appeared at all — otherwise the delta looks like a second, contradictory answer.
    expect(screen.getByText(/Кошторис змінився після покупки/)).toBeTruthy();
  });

  it('warns that an unsigned estimate can still move the quantities, without blocking anything', () => {
    seed([item({ id: 'a' })], null, true);
    renderPage();

    expect(screen.getByText(/Кошторис ще не підписаний/)).toBeTruthy();
    // A hint, not a gate: ticking «куплено» still works.
    fireEvent.click(screen.getByRole('button', { name: 'Профіль CD' }));
    expect(updateMutate).toHaveBeenCalledWith({ itemId: 'a', req: { bought: true } });
  });
});
