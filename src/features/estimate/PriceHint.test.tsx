import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import '@/lib/i18n.ts';
import { catalogApi } from '@/api/catalog.ts';
import { PriceHint } from './PriceHint.tsx';

vi.mock('@/api/catalog.ts', () => ({ catalogApi: { priceHint: vi.fn() } }));

function renderHint(props: Partial<Parameters<typeof PriceHint>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <PriceHint name="Монтаж мауерлату" unit="LINEAR_METER" type="WORK" online {...props} />,
    { wrapper: wrap },
  );
}

beforeEach(() => vi.mocked(catalogApi.priceHint).mockReset());

describe('PriceHint — the market figure under the price field', () => {
  it("his oblast's median names the oblast and how many masters stand behind it", async () => {
    vi.mocked(catalogApi.priceHint).mockResolvedValue({
      level: 'OBLAST', price: 195, mastersCount: 4, region: 'LVIV', computedAt: null,
    });
    renderHint();

    expect(await screen.findByText(/Ринок, Львівська обл\.: ~195.*за м\.п\. · майстрів: 4/)).toBeTruthy();
    const link = screen.getByRole('link', { name: /Порівняти/ });
    expect(link.getAttribute('href')).toContain(encodeURIComponent('site:rabotniki.ua Монтаж мауерлату'));
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('the estimate says «орієнтовно», the library price says «по країні»', async () => {
    vi.mocked(catalogApi.priceHint).mockResolvedValue({
      level: 'OBLAST_ESTIMATE', price: 220, mastersCount: null, region: 'KYIV_CITY', computedAt: null,
    });
    const { unmount } = renderHint();
    expect(await screen.findByText(/Орієнтовно, м\. Київ: ~220/)).toBeTruthy();
    unmount();

    vi.mocked(catalogApi.priceHint).mockResolvedValue({
      level: 'COUNTRY', price: 170, mastersCount: null, region: null, computedAt: null,
    });
    renderHint();
    expect(await screen.findByText(/По країні: ~170/)).toBeTruthy();
  });

  it('no request offline, for a material, a «%» line or a name still being typed', () => {
    renderHint({ online: false });
    renderHint({ type: 'MATERIAL' });
    renderHint({ unit: 'PERCENT' });
    renderHint({ name: 'Мо' });
    expect(catalogApi.priceHint).not.toHaveBeenCalled();
    expect(screen.queryByTestId('price-hint')).toBeNull();
  });
});
