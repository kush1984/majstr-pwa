import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import '@/lib/i18n.ts';
import { catalogApi } from '@/api/catalog.ts';
import { COMPARE_SITES, PriceHint } from './PriceHint.tsx';

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
    expect(screen.getByText('Порівняти:')).toBeTruthy();
  });

  it('«Порівняти» offers every site masters named, each a search for this work there', async () => {
    vi.mocked(catalogApi.priceHint).mockResolvedValue({
      level: 'COUNTRY', price: 170, mastersCount: null, region: null, computedAt: null,
    });
    renderHint();

    await screen.findByTestId('price-hint');
    for (const { label, site } of COMPARE_SITES) {
      const link = screen.getByRole('link', { name: label });
      expect(link.getAttribute('href')).toContain(encodeURIComponent(`site:${site} Монтаж мауерлату`));
      expect(link.getAttribute('target')).toBe('_blank');
    }
    expect(COMPARE_SITES.map(s => s.site)).toEqual(['rabotniki.ua', 'kabanchik.ua', 'budver.com', 'olx.ua']);
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

  it('a work we know nothing about still gets «Порівняти», with no figure of ours', async () => {
    vi.mocked(catalogApi.priceHint).mockResolvedValue(null);
    renderHint({ name: 'Заміна стояка у Петровича' });

    await waitFor(() => expect(catalogApi.priceHint).toHaveBeenCalled());
    expect(screen.getByText('Порівняти:')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'OLX' }).getAttribute('href'))
      .toContain(encodeURIComponent('site:olx.ua Заміна стояка у Петровича'));
    expect(screen.queryByText(/Ринок|Орієнтовно|По країні/)).toBeNull();
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
