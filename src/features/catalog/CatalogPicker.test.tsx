import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { CatalogPicker } from './CatalogPicker.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { catalogApi } from '@/api/catalog.ts';
import type { CatalogItemResponse } from '@/api/types.ts';
import { aUser } from '@/test/factories.ts';

vi.mock('@/api/catalog.ts', () => ({
  catalogApi: { list: vi.fn(), create: vi.fn(), categories: vi.fn(), search: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

function anItem(over: Partial<CatalogItemResponse> & { id: string }): CatalogItemResponse {
  return {
    name: over.id,
    category: null,
    trade: 'PAINTER',
    customTradeId: null,
    customTradeName: null,
    type: 'WORK',
    unit: 'M2',
    defaultPrice: 100,
    sortOrder: 0,
    createdAt: '',
    ...over,
  };
}

/** A catalog big enough that the folders stay shut — the shape a real master's does. */
function bigCatalog(): CatalogItemResponse[] {
  const paint = ['Ґрунтування', 'Шпаклювання', 'Шліфування', 'Фарбування стін', 'Фарбування стелі', 'Захист підлоги'];
  const tile = ['Укладання плитки', 'Затирка швів', 'Гідроізоляція', 'Різання плитки', 'Профіль на кут', 'Прибирання'];
  return [
    ...paint.map((name, i) => anItem({ id: `p${i}`, name, category: 'Малярні роботи', sortOrder: i })),
    ...tile.map((name, i) => anItem({ id: `t${i}`, name, category: 'Плиточні роботи', sortOrder: 10 + i })),
  ];
}

function renderPicker(props: Partial<Parameters<typeof CatalogPicker>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, aUser());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const onPick: (items: CatalogItemResponse[]) => Promise<void> =
    props.onPick ?? vi.fn<(items: CatalogItemResponse[]) => Promise<void>>().mockResolvedValue(undefined);
  render(<CatalogPicker {...props} onPick={onPick} />, { wrapper });
  return { onPick };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(catalogApi.categories).mockResolvedValue([]);
  vi.mocked(catalogApi.search).mockResolvedValue([]);
});

describe('CatalogPicker — categories are the structure', () => {
  it('opens on the FOLDERS, not on every position — a tap opens one and leaves the rest shut', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue(bigCatalog());
    renderPicker();

    // The master's complaint, inverted: two headings, no wall of positions.
    const folders = await screen.findAllByTestId('catalog-category');
    expect(folders).toHaveLength(2);
    expect(screen.queryAllByTestId('catalog-row')).toHaveLength(0);
    expect(screen.getByText('Малярні роботи')).toBeTruthy();

    fireEvent.click(folders[0]);
    await waitFor(() => expect(screen.getAllByTestId('catalog-row')).toHaveLength(6));
    // Still shut, so the other trade's positions cannot be tapped by mistake.
    expect(screen.queryByText('Затирка швів')).toBeNull();
  });

  it('stays open when there is nothing to hide — a short catalog needs no extra tap', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue([
      anItem({ id: 'a', name: 'Ґрунтування', category: 'Малярні роботи' }),
      anItem({ id: 'b', name: 'Затирка швів', category: 'Плиточні роботи' }),
    ]);
    renderPicker();

    expect(await screen.findAllByTestId('catalog-row')).toHaveLength(2);
  });

  it('a search opens every matching folder and says WHERE the hit lives', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue(bigCatalog());
    renderPicker();
    await screen.findAllByTestId('catalog-category');

    fireEvent.change(screen.getByPlaceholderText('Пошук у каталозі...'), {
      target: { value: 'фарбування' },
    });

    // Both hits are visible with no further tap, under their own heading.
    await waitFor(() => expect(screen.getAllByTestId('catalog-row')).toHaveLength(2));
    expect(screen.getAllByTestId('catalog-category')).toHaveLength(1);
    expect(screen.getByText('Малярні роботи')).toBeTruthy();
  });

  it('a folder collapsed while browsing cannot swallow a search hit', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue(bigCatalog());
    renderPicker();

    const folders = await screen.findAllByTestId('catalog-category');
    fireEvent.click(folders[0]); // open
    fireEvent.click(folders[0]); // and shut again — an explicit "not this one"
    await waitFor(() => expect(screen.queryAllByTestId('catalog-row')).toHaveLength(0));

    fireEvent.change(screen.getByPlaceholderText('Пошук у каталозі...'), {
      target: { value: 'ґрунт' },
    });
    await waitFor(() => expect(screen.getAllByTestId('catalog-row')).toHaveLength(1));
  });
});

describe('CatalogPicker — picking', () => {
  it('hands the picks over in CATALOG order, not the order they were tapped', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue(bigCatalog());
    const { onPick } = renderPicker();

    fireEvent.click((await screen.findAllByTestId('catalog-category'))[0]);
    const rows = await screen.findAllByTestId('catalog-row');
    fireEvent.click(rows[2]); // Шліфування first…
    fireEvent.click(rows[0]); // …Ґрунтування second

    fireEvent.click(screen.getByRole('button', { name: /Додати 2/ }));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(vi.mocked(onPick).mock.calls[0][0].map((i) => i.name)).toEqual([
      'Ґрунтування',
      'Шліфування',
    ]);
  });

  it('greys out a position that is already there and refuses the tap', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue(bigCatalog());
    const { onPick } = renderPicker({ disabledNames: ['  ґрунтування '] });

    fireEvent.click((await screen.findAllByTestId('catalog-category'))[0]);
    const rows = await screen.findAllByTestId('catalog-row');
    expect((rows[0] as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(rows[0]);
    expect(screen.queryByRole('button', { name: /Додати/ })).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('in `single` mode a tap applies straight away — no basket to confirm', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue([
      anItem({ id: 'a', name: 'Ґрунтування', category: 'Малярні роботи' }),
    ]);
    const { onPick } = renderPicker({ single: true });

    fireEvent.click((await screen.findAllByTestId('catalog-row'))[0]);
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    expect(vi.mocked(onPick).mock.calls[0][0]).toHaveLength(1);
  });
});

describe('CatalogPicker — description', () => {
  it('shows what a position covers, since the name alone cannot say it (Q3 vs Q4)', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue([
      anItem({
        id: 'a',
        name: 'Шпаклювання стін',
        category: 'Оздоблення',
        description: 'Рівень Q3: під матову фарбу, без бокового світла.',
      }),
      anItem({ id: 'b', name: 'Ґрунтування', category: 'Оздоблення' }),
    ]);
    renderPicker();

    expect(await screen.findByText(/Рівень Q3/)).toBeTruthy();
    // The (i) is offered only where there is something to read, and sits BESIDE the row — a
    // button inside a button would be invalid markup.
    expect(screen.getAllByRole('button', { name: 'Шпаклювання стін' })).toHaveLength(1);
  });
});

describe('CatalogPicker — trade is the top level', () => {
  /** Two trades, big enough that the tree opens on the TRADES — the shape that made the master
   *  ask «не зрозуміло яка категорія до чого відноситься». */
  function twoTradeCatalog(): CatalogItemResponse[] {
    return [
      ...bigCatalog(),
      ...['Монтаж каркаса', 'Обшивка ГКЛ', 'Ґрунтування ГКЛ'].map((name, i) =>
        anItem({ id: `d${i}`, name, trade: 'DRYWALL', category: 'Каркас і обшивка' }),
      ),
    ];
  }

  it('names the trade above its folders — the thing chips could not do with two ticked', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue(twoTradeCatalog());
    renderPicker();

    const trades = await screen.findAllByTestId('catalog-trade');
    expect(trades).toHaveLength(2);
    expect(trades[0].textContent).toContain('Малярні роботи');
    expect(trades[1].textContent).toContain('Гіпсокартон');
    expect(trades[1].textContent).toContain('3'); // and how much is inside
  });

  it('a big multi-trade catalog opens on the TRADES, and one tap opens one trade', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue(twoTradeCatalog());
    renderPicker();

    const trades = await screen.findAllByTestId('catalog-trade');
    expect(screen.queryAllByTestId('catalog-category')).toHaveLength(0);

    fireEvent.click(trades[1]); // Гіпсокартон
    await waitFor(() => expect(screen.getAllByTestId('catalog-category')).toHaveLength(1));
    expect(screen.getByText('Каркас і обшивка')).toBeTruthy();
    // The painter's folders stay shut: one trade's contents cannot be mistaken for another's.
    expect(screen.queryByText('Плиточні роботи')).toBeNull();
  });

  it('draws no trade level for a one-trade master — nothing to disambiguate', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue(bigCatalog());
    renderPicker();

    await screen.findAllByTestId('catalog-category');
    expect(screen.queryAllByTestId('catalog-trade')).toHaveLength(0);
  });

  it('a shared position shows under both trades but is added ONCE', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue([
      anItem({ id: 'p', name: 'Фарбування стін', trade: 'PAINTER', category: 'Малярні роботи' }),
      anItem({
        id: 'hatch',
        name: 'Установка люка-ревізії',
        trade: 'PAINTER',
        category: 'Малярні роботи',
        sharedTrades: [{ trade: 'DRYWALL', category: 'Каркас і обшивка' }],
      }),
      anItem({ id: 'd', name: 'Монтаж каркаса', trade: 'DRYWALL', category: 'Каркас і обшивка' }),
    ]);
    const { onPick } = renderPicker();

    const rows = await screen.findAllByTestId('catalog-row');
    expect(rows).toHaveLength(4); // 2 painter + 2 drywall, the hatch counted in both
    expect(screen.getAllByText('Установка люка-ревізії')).toHaveLength(2);

    fireEvent.click(screen.getAllByText('Установка люка-ревізії')[0]);
    fireEvent.click(screen.getByRole('button', { name: /Додати 1/ }));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(vi.mocked(onPick).mock.calls[0][0].map((i) => i.id)).toEqual(['hatch']);
  });
});
