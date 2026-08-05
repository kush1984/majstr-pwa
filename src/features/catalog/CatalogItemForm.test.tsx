import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { CatalogItemForm } from './CatalogItemForm.tsx';
import { catalogApi } from '@/api/catalog.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import type { CatalogItemResponse } from '@/api/types.ts';
import { aUser } from '@/test/factories.ts';

/**
 * The category field. It used to be free text with a <datalist>, which on a phone gives no visible
 * list at all and lets the same bucket be re-typed four ways — «Кладка», «КЛАДКА», «Кладочні» — the
 * mess the seed cleanup had to undo. Now: a dropdown of the categories that exist UNDER THE CHOSEN
 * TRADE, and free text only when nothing is picked.
 */
vi.mock('@/api/catalog.ts', () => ({
  catalogApi: { list: vi.fn(), categories: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const catalog: CatalogItemResponse[] = [
  { id: '1', name: 'Розетка', category: 'Розетки', trade: 'ELECTRICAL',
    type: 'WORK', unit: 'PIECE', defaultPrice: 100, sortOrder: 0, createdAt: '' },
  { id: '2', name: 'Автомат', category: 'Щит', trade: 'ELECTRICAL',
    type: 'WORK', unit: 'PIECE', defaultPrice: 200, sortOrder: 0, createdAt: '' },
  { id: '3', name: 'Ще одна розетка', category: 'Розетки', trade: 'ELECTRICAL',
    type: 'WORK', unit: 'PIECE', defaultPrice: 120, sortOrder: 0, createdAt: '' },
  // another trade — must NOT show up under ELECTRICAL
  { id: '4', name: 'Плитка', category: 'Укладання', trade: 'TILING',
    type: 'WORK', unit: 'M2', defaultPrice: 900, sortOrder: 0, createdAt: '' },
];

function renderForm(initial: CatalogItemResponse | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // two trades, so the trade picker renders and the category list can be re-narrowed
  qc.setQueryData(ME_QUERY_KEY, aUser({ trades: ['ELECTRICAL', 'TILING'] }));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<CatalogItemForm initial={initial} defaultTrade="ELECTRICAL" onDone={() => {}} />,
                { wrapper });
}

const sel = (id: string) => document.querySelector(id) as HTMLSelectElement;
const options = () => [...sel('#ci-category').options].map((o) => o.textContent);
const set = (id: string, value: string) =>
  fireEvent.change(document.querySelector(id)!, { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(catalogApi.list).mockResolvedValue(catalog);
});

describe('CatalogItemForm — category', () => {
  it('lists the categories of the chosen trade, deduplicated, and nothing from another trade',
     async () => {
    renderForm();
    await waitFor(() => expect(options()).toContain('Розетки'));

    // «Розетки» appears twice in the catalog and once in the list.
    expect(options()).toEqual(['Без категорії', 'Розетки', 'Щит']);
    expect(options()).not.toContain('Укладання');   // that one is TILING
  });

  it('re-narrows the list when the trade changes', async () => {
    renderForm();
    await waitFor(() => expect(options()).toContain('Щит'));

    set('#ci-trade', 'TILING');

    await waitFor(() => expect(options()).toContain('Укладання'));
    expect(options()).not.toContain('Щит');
  });

  it('saves free text as the category when nothing is picked', async () => {
    vi.mocked(catalogApi.create).mockResolvedValue(catalog[0]);
    renderForm();
    await waitFor(() => expect(options()).toContain('Розетки'));

    set('#ci-name', 'Штроблення 20х20');
    set('#ci-category-new', 'Штроблення');
    set('#ci-price', '220');
    fireEvent.click(screen.getByRole('button', { name: /Додати|Зберегти/ }));

    await waitFor(() => expect(catalogApi.create).toHaveBeenCalled());
    expect(vi.mocked(catalogApi.create).mock.calls[0][0]).toMatchObject({
      name: 'Штроблення 20х20', category: 'Штроблення', trade: 'ELECTRICAL',
    });
  });

  it('hides the free-text field once a category is picked, and saves the picked one', async () => {
    vi.mocked(catalogApi.create).mockResolvedValue(catalog[0]);
    renderForm();
    await waitFor(() => expect(options()).toContain('Щит'));
    expect(screen.getByPlaceholderText(/нову категорію/i)).toBeTruthy();

    set('#ci-category', 'Щит');
    await waitFor(() => expect(screen.queryByPlaceholderText(/нову категорію/i)).toBeNull());

    set('#ci-name', 'ПЗВ двополюсний');
    set('#ci-price', '600');
    fireEvent.click(screen.getByRole('button', { name: /Додати|Зберегти/ }));

    await waitFor(() => expect(catalogApi.create).toHaveBeenCalled());
    expect(vi.mocked(catalogApi.create).mock.calls[0][0]).toMatchObject({ category: 'Щит' });
  });

  it("keeps an existing item's category selected even when it belongs to another trade",
     async () => {
    // Editing an ELECTRICAL item filed under a TILING category: the value has to stay on the list,
    // otherwise the <select> silently falls back to «Без категорії» and saving wipes the category
    // the master had — a data loss with no warning and nothing on screen to explain it.
    renderForm({
      id: '9', name: 'Дивна позиція', category: 'Укладання', trade: 'ELECTRICAL',
      type: 'WORK', unit: 'PIECE', defaultPrice: 300, sortOrder: 0, createdAt: '',
    });
    await waitFor(() => expect(options()).toContain('Розетки'));

    expect(options()).toContain('Укладання');
    expect(sel('#ci-category').value).toBe('Укладання');
  });
});
