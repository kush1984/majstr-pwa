import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/lib/i18n.ts';
import { PriceListPage } from './PriceListPage.tsx';
import { catalogApi } from '@/api/catalog.ts';
import { priceListApi } from '@/api/priceList.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { senderSheetStore } from '@/features/sender/senderGate.ts';
import { aUser } from '@/test/factories.ts';
import type { CatalogItemResponse, UserResponse } from '@/api/types.ts';

vi.mock('@/api/catalog.ts', () => ({
  catalogApi: { list: vi.fn(), categories: vi.fn() },
}));
vi.mock('@/api/priceList.ts', () => ({
  priceListApi: { get: vi.fn(), save: vi.fn(), revoke: vi.fn(), preview: vi.fn(), fetchPdfBlob: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const work = (id: string, name: string, price: number, over: Partial<CatalogItemResponse> = {}): CatalogItemResponse => ({
  id, name, category: 'Підлога', trade: 'TILING', customTradeId: null, customTradeName: null,
  type: 'WORK', unit: 'M2', defaultPrice: price, sortOrder: 0, createdAt: '', ...over,
});
const items: CatalogItemResponse[] = [
  work('w1', 'Укладання плитки', 650),
  work('w2', 'Гідроізоляція підлоги', 180, { sortOrder: 1 }),
  work('w3', 'Продзвонка', 0, { sortOrder: 2 }),
  work('m1', 'Клей для плитки', 30, { type: 'MATERIAL', unit: 'KG', sortOrder: 3 }),
];
const live = 'https://api.majstr.pro/portal/index.html?l=tok';

function renderPage(me: UserResponse = aUser(), seed?: (qc: QueryClient) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, me);
  seed?.(qc);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter><QueryClientProvider client={qc}>{children}</QueryClientProvider></MemoryRouter>
  );
  return render(<PriceListPage />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(catalogApi.list).mockResolvedValue(items);
  vi.mocked(catalogApi.categories).mockResolvedValue([]);
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe('PriceListPage — «Прайс для клієнта»', () => {
  it("never ticks from the offline snapshot: 1.79.0's pre-ticked answer is replaced by the server's", async () => {
    vi.mocked(priceListApi.get).mockResolvedValue({ url: null, configured: false, itemIds: [], libraryPricedIds: [] });
    renderPage(aUser(), (qc) => qc.setQueryData(['price-list'],
      { url: null, configured: false, itemIds: ['w1', 'w2'], libraryPricedIds: [] }));

    expect(await screen.findByText('Відмітьте роботи для прайсу')).toBeTruthy();
    expect(priceListApi.get).toHaveBeenCalled();
  });

  it('ticks nothing for the master, shows works only, and blocks a work with no price', async () => {
    vi.mocked(priceListApi.get).mockResolvedValue({ url: null, configured: false, itemIds: [], libraryPricedIds: [] });
    renderPage();

    expect(await screen.findByText('Відмітьте роботи для прайсу')).toBeTruthy();
    expect(screen.getByText('Укладання плитки')).toBeTruthy();
    expect(screen.queryByText('Клей для плитки')).toBeNull();
    expect(screen.queryByText(/ціна з бібліотеки/)).toBeNull();
    expect(screen.getByText('без ціни — не піде в прайс')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Продзвонка' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /Копіювати посилання/ }).hasAttribute('disabled')).toBe(true);
  });

  it('a whole-category tick skips the unpriced work, and copying sends exactly what is ticked', async () => {
    vi.mocked(priceListApi.get).mockResolvedValue({ url: null, configured: false, itemIds: [], libraryPricedIds: [] });
    vi.mocked(priceListApi.save).mockResolvedValue({ url: live, configured: true, itemIds: ['w1', 'w2'], libraryPricedIds: [] });
    renderPage();
    await screen.findByText('Укладання плитки');

    fireEvent.click(screen.getByRole('button', { name: /Вибрати категорію/ }));
    expect(screen.getByText('У прайсі 2 позиції')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Копіювати посилання/ }));

    await waitFor(() => expect(priceListApi.save).toHaveBeenCalledTimes(1));
    expect(vi.mocked(priceListApi.save).mock.calls[0][0].itemIds.sort()).toEqual(['w1', 'w2']);
  });

  it('brings back what he ticked last time, minus a work since priced at 0 ₴ or no longer on screen', async () => {
    vi.mocked(priceListApi.get).mockResolvedValue({
      url: live, configured: true, itemIds: ['w1', 'w3', 'hidden-1'], libraryPricedIds: [],
    });
    renderPage();

    expect(await screen.findByText('У прайсі 1 позиція')).toBeTruthy();
    expect(screen.getByText('Посилання на прайс уже надіслане й відкривається')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Закрити посилання' })).toBeTruthy();
  });

  it('«Переглянути» opens a ten-minute pass before anything is sent, and mints no link', async () => {
    vi.mocked(priceListApi.get).mockResolvedValue({ url: null, configured: true, itemIds: ['w1'], libraryPricedIds: [] });
    vi.mocked(priceListApi.preview).mockResolvedValue({
      url: 'https://api.majstr.test/portal/index.html?vl=pass', expiresAt: '2026-11-14T10:00:00Z',
    });
    const tab = { opener: 'app', closed: false, location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    renderPage();
    await screen.findByText('У прайсі 1 позиція');

    fireEvent.click(screen.getByRole('button', { name: /Переглянути/ }));

    await waitFor(() => expect(tab.location.href).toBe('https://api.majstr.test/portal/index.html?vl=pass'));
    expect(priceListApi.preview).toHaveBeenCalledWith({ itemIds: ['w1'] });
    expect(priceListApi.save).not.toHaveBeenCalled();
  });

  it('a master with no name is asked for it first — nothing is sent on a 403', async () => {
    vi.mocked(priceListApi.get).mockResolvedValue({ url: null, configured: true, itemIds: ['w1'], libraryPricedIds: [] });
    renderPage(aUser({ fullName: '' }));
    await screen.findByText('У прайсі 1 позиція');

    fireEvent.click(screen.getByRole('button', { name: /Копіювати посилання/ }));

    await waitFor(() => expect(senderSheetStore.isOpen()).toBe(true));
    expect(priceListApi.save).not.toHaveBeenCalled();
  });
});
