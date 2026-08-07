import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/lib/i18n.ts';
import { CatalogPage } from './CatalogPage.tsx';
import { catalogApi } from '@/api/catalog.ts';
import type { CatalogItemResponse } from '@/api/types.ts';

vi.mock('@/api/catalog.ts', () => ({
  catalogApi: {
    list: vi.fn(), categories: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
    deleteItems: vi.fn(), reorder: vi.fn(),
  },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const LONG = 'Профіль/куточок для плитки алюмінієвий 10 мм полірований';

const item: CatalogItemResponse = {
  id: 'c1', name: LONG, category: 'Плитка', trade: 'TILING', customTradeId: null, customTradeName: null,
  type: 'MATERIAL', unit: 'PIECE', defaultPrice: 220, sortOrder: 0, createdAt: '',
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter><QueryClientProvider client={qc}>{children}</QueryClientProvider></MemoryRouter>
  );
  return render(<CatalogPage />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(catalogApi.categories).mockResolvedValue([]);
});

describe('CatalogPage — long position names', () => {
  it('wraps a long name instead of cutting it off', async () => {
    // Reported from a real phone: catalog names are long and specific, and the TAIL is what
    // tells two positions apart («…алюмінієвий 10 мм» vs «…пластиковий»). Truncating left the
    // master tapping rows they could not read. Same treatment the template rows already had.
    //
    // jsdom does no layout, so this asserts the mechanism rather than pixels: the full text is
    // present and the element is not clipped to one line. That is enough to catch the actual
    // regression — someone putting `truncate` back.
    vi.mocked(catalogApi.list).mockResolvedValue([item]);

    renderPage();

    const name = await screen.findByText(LONG);
    await waitFor(() => expect(name).toBeTruthy());
    expect(name.className).toContain('break-words');
    expect(name.className).not.toContain('truncate');
  });
});

describe('CatalogPage — the master arranges and prunes his own catalog', () => {
  const two: CatalogItemResponse[] = [
    { id: 'c1', name: 'Укладання плитки', category: 'Плитка', trade: 'TILING', customTradeId: null, customTradeName: null,
      type: 'WORK', unit: 'M2', defaultPrice: 500, sortOrder: 0, createdAt: '' },
    { id: 'c2', name: 'Затирання швів', category: 'Плитка', trade: 'TILING', customTradeId: null, customTradeName: null,
      type: 'WORK', unit: 'M2', defaultPrice: 120, sortOrder: 1, createdAt: '' },
  ];

  it('offers add / delete-positions / delete-all behind the FAB', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue(two);
    renderPage();
    await waitFor(() => expect(screen.getByText('Укладання плитки')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Дії з каталогом' }));

    expect(screen.getByText('Видалити позиції')).toBeTruthy();
    expect(screen.getByText('Видалити все')).toBeTruthy();
  });

  it('deletes the ticked positions in ONE call, not one request per row', async () => {
    // 200 single deletes can half-succeed and leave a list nobody chose; one operation cannot.
    vi.mocked(catalogApi.list).mockResolvedValue(two);
    vi.mocked(catalogApi.deleteItems).mockResolvedValue({ deleted: 2 });
    renderPage();
    await waitFor(() => expect(screen.getByText('Укладання плитки')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Дії з каталогом' }));
    fireEvent.click(screen.getByText('Видалити позиції'));
    // One tap on the category ticks everything under it — the whole point on a 167-position list.
    fireEvent.click(screen.getByRole('button', { name: /Вибрати категорію/ }));
    // Both the bar and the confirm dialog say «Видалити» — the bar is the first in the DOM.
    fireEvent.click(screen.getAllByRole('button', { name: 'Видалити' })[0]);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Видалити' }).length).toBeGreaterThan(1));
    const buttons = screen.getAllByRole('button', { name: 'Видалити' });
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(catalogApi.deleteItems).toHaveBeenCalledTimes(1));
    expect(vi.mocked(catalogApi.deleteItems).mock.calls[0][0].sort()).toEqual(['c1', 'c2']);
  });

  it('has no manual reorder grips — a catalog is searched and priced, not arranged', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue(two);
    renderPage();
    await waitFor(() => expect(screen.getByText('Укладання плитки')).toBeTruthy());

    expect(screen.queryByRole('button', { name: 'Перетягнути позицію' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Перетягнути категорію' })).toBeNull();
  });

  it('an empty filter shows the onboarding with «Стартовий набір» — not a blank page', async () => {
    // The catalog is works-only. Picking «Матеріали» used to render a BLANK page (works path) or
    // the onboarding (materials path). Now BOTH show the onboarding, whose «Стартовий набір» is the
    // master's one way to restore the default catalog after clearing it — even under a filter.
    vi.mocked(catalogApi.list).mockResolvedValue(two);
    renderPage();
    await waitFor(() => expect(screen.getByText('Укладання плитки')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Матеріали' }));

    expect(await screen.findByText('Каталог порожній')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Стартовий набір' })).toBeTruthy();
    // Switching back to «Роботи» brings the works straight back (type filter is client-side).
    fireEvent.click(screen.getByRole('button', { name: 'Роботи' }));
    expect(await screen.findByText('Укладання плитки')).toBeTruthy();
  });

  it('a genuinely empty catalog shows the same onboarding empty state', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('Каталог порожній')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Стартовий набір' })).toBeTruthy();
  });
});
