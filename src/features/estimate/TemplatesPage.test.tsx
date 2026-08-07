import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { TemplatesPage } from './TemplatesPage.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { estimateTemplatesApi } from '@/api/estimateTemplates.ts';
import { catalogApi } from '@/api/catalog.ts';
import type {
  CatalogItemResponse,
  EstimateTemplateDetail,
  EstimateTemplateSummary,
  UserResponse,
} from '@/api/types.ts';
import { aUser } from '@/test/factories.ts';
import { asButton } from '@/test/dom.ts';

vi.mock('@/api/estimateTemplates.ts', () => ({
  estimateTemplatesApi: {
    list: vi.fn(),
    get: vi.fn(),
    rename: vi.fn(),
    setTrade: vi.fn(),
    remove: vi.fn(),
    addItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));
vi.mock('@/api/catalog.ts', () => ({
  catalogApi: { list: vi.fn(), create: vi.fn(), categories: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const me: UserResponse = aUser();
const own: EstimateTemplateSummary = {
  id: 'own1', name: 'Моя ванна', trade: null, customTradeId: null, customTradeName: null, isDefault: false, itemCount: 1,
};
const ownDetail: EstimateTemplateDetail = {
  id: 'own1', name: 'Моя ванна', trade: null, customTradeId: null, customTradeName: null, isDefault: false,
  items: [{ id: 'it1', name: 'Розетка', type: 'WORK', unit: 'PIECE', sortOrder: 0 }],
};
const catalog: CatalogItemResponse[] = [
  // already in the template by name → must be disabled in the picker
  { id: 'c1', name: 'Розетка', category: 'Електрика', trade: 'ELECTRICAL', customTradeId: null, customTradeName: null, type: 'WORK', unit: 'PIECE', defaultPrice: 180, sortOrder: 0, createdAt: '' },
  // fresh → selectable
  { id: 'c2', name: 'Кабель ВВГ', category: 'Кабель', trade: 'ELECTRICAL', customTradeId: null, customTradeName: null, type: 'MATERIAL', unit: 'M', defaultPrice: 38.5, sortOrder: 0, createdAt: '' },
];

function renderPage(meOverride: UserResponse = me) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, meOverride);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<TemplatesPage />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(catalogApi.categories).mockResolvedValue([]);
});

describe('TemplatesPage — edit own template', () => {
  it('pencil opens the editor; catalog picker skips present items and adds a fresh one', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own]);
    vi.mocked(estimateTemplatesApi.get).mockResolvedValue(ownDetail);
    vi.mocked(catalogApi.list).mockResolvedValue(catalog);
    vi.mocked(estimateTemplatesApi.addItem).mockResolvedValue(ownDetail);

    renderPage();

    // The own template is listed; the pencil opens the full editor (not just rename).
    expect(await screen.findByText('Моя ванна')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Редагувати' }));
    expect(await screen.findByText('Редагувати шаблон')).toBeTruthy();

    // Catalog tab is default: both rows render; the one already in the template is disabled.
    const rows = (await screen.findAllByTestId('catalog-row'));
    expect(rows).toHaveLength(2);
    const presentRow = rows.find((r) => r.textContent?.includes('Розетка'))!;
    const freshRow = rows.find((r) => r.textContent?.includes('Кабель ВВГ'))!;
    expect(asButton(presentRow).disabled).toBe(true);
    expect(asButton(freshRow).disabled).toBe(false);

    // Select the fresh one → add → addItem called with its name/type/unit.
    fireEvent.click(freshRow);
    fireEvent.click(screen.getByRole('button', { name: /Додати 1/ }));
    await waitFor(() =>
      // Third arg = the client-generated UUID that makes the add idempotent on replay.
      expect(estimateTemplatesApi.addItem).toHaveBeenCalledWith('own1', {
        name: 'Кабель ВВГ', type: 'MATERIAL', unit: 'M',
      }, expect.any(String)),
    );
  });

  it('manual add → offers to save the new position to the catalog', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own]);
    vi.mocked(estimateTemplatesApi.get).mockResolvedValue(ownDetail);
    vi.mocked(catalogApi.list).mockResolvedValue([]);
    vi.mocked(estimateTemplatesApi.addItem).mockResolvedValue(ownDetail);
    vi.mocked(catalogApi.create).mockResolvedValue({
      id: 'cN', name: 'Нова робота', category: null, trade: null, type: 'WORK',
      unit: 'M2', defaultPrice: 0, sortOrder: 0, createdAt: '',
    } as never);

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Редагувати' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Вручну' }));
    fireEvent.change(screen.getByPlaceholderText('Назва позиції'), {
      target: { value: 'Нова робота' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Додати позицію' }));

    // Position added to the template, then the save-to-catalog prompt appears.
    await waitFor(() =>
      expect(estimateTemplatesApi.addItem).toHaveBeenCalledWith('own1', {
        name: 'Нова робота', type: 'WORK', unit: 'M2',
      }, expect.any(String)),
    );
    expect(await screen.findByText(/у ваш каталог/)).toBeTruthy();

    // Confirm → catalog entry created with name/type/unit + empty price (0).
    fireEvent.click(screen.getByRole('button', { name: 'Додати в каталог' }));
    await waitFor(() =>
      expect(catalogApi.create).toHaveBeenCalledWith({
        name: 'Нова робота', category: undefined, trade: 'OTHER',
        type: 'WORK', unit: 'M2', defaultPrice: 0,
      }, expect.any(String)),
    );
  });

  it('row tap opens a read-only preview (no edit controls)', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own]);
    vi.mocked(estimateTemplatesApi.get).mockResolvedValue(ownDetail);

    renderPage();

    fireEvent.click(await screen.findByText('Моя ванна'));
    // The composition shows...
    expect(await screen.findByText('Розетка')).toBeTruthy();
    // ...but there is no "add position" control in read-only preview.
    expect(screen.queryByText('Додати позицію')).toBeNull();
  });

  it('re-files a SYSTEM template into another trade from the preview (own setting)', async () => {
    const sys: EstimateTemplateSummary = {
      id: 's1', name: 'ГІПСОКАРТОН', trade: 'DRYWALL', customTradeId: null, customTradeName: null, isDefault: true, itemCount: 5,
    };
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([sys]);
    vi.mocked(estimateTemplatesApi.get).mockResolvedValue({
      id: 's1', name: 'ГІПСОКАРТОН', trade: 'DRYWALL', customTradeId: null, customTradeName: null, isDefault: true, items: [],
    });
    vi.mocked(estimateTemplatesApi.setTrade).mockResolvedValue({ ...sys, trade: 'PAINTER' });

    renderPage();
    fireEvent.click(await screen.findByText('ГІПСОКАРТОН'));

    // The trade select in the preview → move to a different trade.
    const select = await screen.findByDisplayValue(/Гіпсокартон/);
    fireEvent.change(select, { target: { value: 'PAINTER' } });

    await waitFor(() => expect(estimateTemplatesApi.setTrade).toHaveBeenCalledWith(
      's1', { trade: 'PAINTER', customTradeId: null }));
  });

  it('re-files MY OWN template into a custom trade — the picker offers it, a system default would not', async () => {
    const meWithCustom = aUser({ customTrades: [{ id: 'ct1', name: 'Натяжні стелі', sortOrder: 0 }] });
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own]);
    vi.mocked(estimateTemplatesApi.get).mockResolvedValue(ownDetail);
    vi.mocked(estimateTemplatesApi.setTrade).mockResolvedValue({
      ...own, trade: 'OTHER', customTradeId: 'ct1', customTradeName: 'Натяжні стелі',
    });

    renderPage(meWithCustom);
    fireEvent.click(await screen.findByText('Моя ванна'));

    const select = await screen.findByRole('combobox');
    expect(screen.getByText(/Натяжні стелі/)).toBeTruthy();
    fireEvent.change(select, { target: { value: 'custom:ct1' } });

    await waitFor(() => expect(estimateTemplatesApi.setTrade).toHaveBeenCalledWith(
      'own1', { trade: null, customTradeId: 'ct1' }));
  });
});

describe('TemplatesPage — trade filter chips', () => {
  const defaults: EstimateTemplateSummary[] = [
    { id: 'd1', name: 'Електрика квартири', trade: 'ELECTRICAL', customTradeId: null, customTradeName: null, isDefault: true, itemCount: 3 },
    { id: 'd2', name: 'Санвузол сантехніка', trade: 'PLUMBING', customTradeId: null, customTradeName: null, isDefault: true, itemCount: 4 },
  ];

  it('narrows the list to the picked trade', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own, ...defaults]);

    renderPage();

    // Both defaults visible with no filter.
    expect(await screen.findByText('Електрика квартири')).toBeTruthy();
    expect(screen.getByText('Санвузол сантехніка')).toBeTruthy();

    // Pick the "Сантехніка" chip (capital С matches only the chip label, not the
    // lowercase row name) → the electrical default drops out.
    fireEvent.click(screen.getByRole('button', { name: /Сантехніка/ }));
    await waitFor(() => expect(screen.queryByText('Електрика квартири')).toBeNull());
    expect(screen.getByText('Санвузол сантехніка')).toBeTruthy();
  });
});
