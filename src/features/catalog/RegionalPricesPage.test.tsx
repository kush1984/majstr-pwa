import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/lib/i18n.ts';
import { RegionalPricesPage, percentVsCountry } from './RegionalPricesPage.tsx';
import { catalogApi } from '@/api/catalog.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { aUser } from '@/test/factories.ts';
import type { CatalogItemResponse, UserResponse } from '@/api/types.ts';

vi.mock('@/api/catalog.ts', () => ({
  catalogApi: { list: vi.fn(), regionalPrices: vi.fn() },
}));
vi.mock('@/api/upgrade.ts', () => ({ upgradeApi: { click: vi.fn() } }));

const work = (id: string, name: string, price: number, over: Partial<CatalogItemResponse> = {}): CatalogItemResponse => ({
  id, name, category: 'Покрівля', trade: 'BUILDER', customTradeId: null, customTradeName: null,
  type: 'WORK', unit: 'LINEAR_METER', defaultPrice: price, sortOrder: 0, createdAt: '', ...over,
});
const items: CatalogItemResponse[] = [
  work('w1', 'Монтаж мауерлату', 150),
  work('w2', 'Кладка перегородок', 300, { unit: 'M2', sortOrder: 1 }),
  work('w3', 'Щось зовсім своє', 100, { unit: 'PIECE', sortOrder: 2 }),
];

function renderPage(me: UserResponse) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, me);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter><QueryClientProvider client={qc}>{children}</QueryClientProvider></MemoryRouter>
  );
  return render(<RegionalPricesPage />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(catalogApi.list).mockResolvedValue(items);
  vi.mocked(catalogApi.regionalPrices).mockResolvedValue({
    region: 'LVIV', factor: 1.083, computedAt: '2026-11-21T03:00:00Z',
    items: [
      { itemId: 'w1', level: 'OBLAST', regionalPrice: 195, mastersCount: 4, countryPrice: 170 },
      { itemId: 'w2', level: 'OBLAST_ESTIMATE', regionalPrice: 430, mastersCount: null, countryPrice: 400 },
    ],
  });
});

describe('RegionalPricesPage — «Ціни по областях»', () => {
  it('opens on his own oblast; each work shows his price, the oblast median or estimate, and the country', async () => {
    renderPage(aUser({ plan: 'PRO', region: 'LVIV' }));

    expect(await screen.findByText('Монтаж мауерлату')).toBeTruthy();
    expect(catalogApi.regionalPrices).toHaveBeenCalledWith('LVIV');
    expect(screen.getByText('майстрів: 4')).toBeTruthy();
    expect(screen.getByText('орієнтовно')).toBeTruthy();
    expect(screen.getByText(/Ціни тут \+8 % до середніх по країні/)).toBeTruthy();
    // A work with no figure anywhere is not listed.
    expect(screen.queryByText('Щось зовсім своє')).toBeNull();
  });

  it('«З цінами області» hides rows with only a country figure; another oblast is asked for by name', async () => {
    vi.mocked(catalogApi.regionalPrices).mockResolvedValue({
      // As the server sends it: null fields are left OUT of the JSON (Jackson non_null), not null.
      region: 'KYIV_CITY',
      items: [
        { itemId: 'w1', countryPrice: 170 },
        { itemId: 'w2', level: 'OBLAST', regionalPrice: 480, mastersCount: 6, countryPrice: 400 },
      ],
    });
    renderPage(aUser({ plan: 'PRO', region: 'LVIV' }));
    fireEvent.change(await screen.findByLabelText('Область'), { target: { value: 'KYIV_CITY' } });
    await waitFor(() => expect(catalogApi.regionalPrices).toHaveBeenCalledWith('KYIV_CITY'));
    expect(await screen.findByText('Монтаж мауерлату')).toBeTruthy();
    expect(screen.getByText(/замало для порівняння/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'З цінами області' }));
    expect(screen.queryByText('Монтаж мауерлату')).toBeNull();
    expect(screen.getByText('Кладка перегородок')).toBeTruthy();
  });

  it('FREE sees the PRO pitch and asks the server for nothing', async () => {
    renderPage(aUser({ plan: 'FREE', region: 'LVIV' }));

    expect(await screen.findByText('Ціни по областях — у PRO')).toBeTruthy();
    expect(catalogApi.regionalPrices).not.toHaveBeenCalled();
  });

  it('the factor reads as a signed percent', () => {
    expect(percentVsCountry(1.12)).toBe('+12 %');
    expect(percentVsCountry(0.9)).toBe('−10 %');
    expect(percentVsCountry(1)).toBe('0 %');
  });
});
