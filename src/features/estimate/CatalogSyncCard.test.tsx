import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import type { CatalogItemResponse, EstimateItemResponse } from '@/api/types.ts';

const syncMutate = vi.fn();
vi.mock('@/features/catalog/useCatalog.ts', () => ({
  useCatalog: () => ({ data: catalog }),
  useCatalogSync: () => ({ mutate: syncMutate }),
  useDeleteCatalogItems: () => ({ mutate: vi.fn() }),
}));

const { CatalogSyncCard } = await import('./CatalogSyncCard.tsx');

const catalog: CatalogItemResponse[] = [
  { id: 'c1', name: 'Стяжка', category: 'Стяжка', trade: 'FLOORING', customTradeId: null, customTradeName: null,
    type: 'WORK', unit: 'M2', defaultPrice: 650, sortOrder: 0 } as CatalogItemResponse,
  { id: 'c2', name: 'Ґрунтування', category: 'Стяжка', trade: 'FLOORING', customTradeId: null, customTradeName: null,
    type: 'WORK', unit: 'M2', defaultPrice: 40, sortOrder: 1 } as CatalogItemResponse,
];

const line = (over: Partial<EstimateItemResponse>): EstimateItemResponse => ({
  id: 'l', type: 'WORK', name: 'Стяжка', category: 'Стяжка', unit: 'M2', quantity: 10, unitPrice: 700,
  lineTotal: 7000, sortOrder: 0, measurementRefs: [], quantityManual: false, percentBaseKind: null,
  percentBaseItemId: null, baseDetached: false, trade: 'FLOORING', sourceUnitPrice: 520,
  ...over,
} as EstimateItemResponse);

const items = [
  line({ id: 'up' }),                                                   // dearer than the catalog
  line({ id: 'down', name: 'Ґрунтування', unitPrice: 30, lineTotal: 300 }), // cheaper: a discount?
  line({ id: 'new', name: 'Демонтаж ламінату', unitPrice: 130, lineTotal: 1300 }),
];

function renderCard() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CatalogSyncCard estimateId="e1" items={items} />
    </QueryClientProvider>,
  );
}

describe('CatalogSyncCard', () => {
  beforeEach(() => {
    localStorage.clear();
    syncMutate.mockClear();
  });

  it('says how many prices differ and how many positions are missing', () => {
    renderCard();
    expect(screen.getByText('Ціни в 2 позиціях відрізняються від каталогу')).toBeTruthy();
    expect(screen.getByText('Ще 1 позиції немає в каталозі.')).toBeTruthy();
  });

  it('«Не зараз» hides it', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Не зараз' }));
    expect(screen.queryByText(/відрізняються від каталогу/)).toBeNull();
  });

  it('ticks a higher price, never a lower one or a missing position; sends client prices only', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Оновити каталог →' }));
    const boxes = screen.getAllByRole<HTMLInputElement>('checkbox');
    expect(boxes.map((b) => b.checked)).toEqual([true, false, false]);

    fireEvent.click(screen.getByRole('button', { name: 'Оновити 1 позицію' }));
    expect(syncMutate).toHaveBeenCalledTimes(1);
    const { req } = syncMutate.mock.calls[0][0] as { req: { updates: unknown[]; creates: unknown[] } };
    expect(req.updates).toEqual([{ catalogItemId: 'c1', defaultPrice: 700 }]);
    expect(req.creates).toEqual([]);
    expect(JSON.stringify(req)).not.toContain('520');
  });

  it('a missing position is added only when ticked, at the line price and trade', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Оновити каталог →' }));
    const boxes = screen.getAllByRole('checkbox');
    fireEvent.click(boxes[0]); // untick the price
    fireEvent.click(boxes[2]); // tick the missing one
    fireEvent.click(screen.getByRole('button', { name: 'Оновити 1 позицію' }));
    const { req } = syncMutate.mock.calls[0][0] as { req: { creates: Record<string, unknown>[] } };
    expect(req.creates).toHaveLength(1);
    expect(req.creates[0]).toMatchObject({ name: 'Демонтаж ламінату', defaultPrice: 130, trade: 'FLOORING', unit: 'M2' });
  });

  it('nothing ticked: the button is disabled', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Оновити каталог →' }));
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Оновити 0 позицій' }).disabled).toBe(true);
  });
});
