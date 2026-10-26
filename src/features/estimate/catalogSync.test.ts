import { describe, it, expect, beforeEach } from 'vitest';
import type { CatalogItemResponse, EstimateItemResponse } from '@/api/types.ts';
import { catalogDivergence, rememberNotNow, shouldShowCard } from './catalogSync.ts';

const line = (over: Partial<EstimateItemResponse> = {}): EstimateItemResponse => ({
  id: 'l1', type: 'WORK', name: 'Стяжка', category: 'Стяжка', unit: 'M2', quantity: 10,
  unitPrice: 700, lineTotal: 7000, sortOrder: 0, measurementRefs: [], quantityManual: false,
  percentBaseKind: null, percentBaseItemId: null, baseDetached: false, trade: 'FLOORING',
  ...over,
} as EstimateItemResponse);

const pos = (over: Partial<CatalogItemResponse> = {}): CatalogItemResponse => ({
  id: 'c1', name: 'Стяжка', category: 'Стяжка', trade: 'FLOORING', customTradeId: null,
  customTradeName: null, type: 'WORK', unit: 'M2', defaultPrice: 650, sortOrder: 0,
  ...over,
} as CatalogItemResponse);

describe('catalogDivergence', () => {
  it('a matched line at another price differs; at the same price it does not', () => {
    expect(catalogDivergence([line()], [pos()]).differs).toHaveLength(1);
    expect(catalogDivergence([line({ unitPrice: 650 })], [pos()]).differs).toHaveLength(0);
  });

  it('matches by trimmed, case-folded name', () => {
    const d = catalogDivergence([line({ name: '  стяжка ' })], [pos()]);
    expect(d.differs[0].catalog.id).toBe('c1');
  });

  it('reads the CLIENT price, never the crew price', () => {
    const d = catalogDivergence([line({ unitPrice: 700, sourceUnitPrice: 520 })], [pos()]);
    expect(d.differs[0].price).toBe(700);
  });

  it('a price below the catalog is flagged as a possible discount', () => {
    expect(catalogDivergence([line({ unitPrice: 600 })], [pos()]).differs[0].lower).toBe(true);
    expect(catalogDivergence([line({ unitPrice: 700 })], [pos()]).differs[0].lower).toBe(false);
  });

  it('the same name in another unit is skipped — not a difference, not «missing»', () => {
    const d = catalogDivergence([line({ unit: 'LINEAR_METER' })], [pos()]);
    expect(d.differs).toHaveLength(0);
    expect(d.missing).toHaveLength(0);
  });

  it('two lines naming one position at different prices are skipped', () => {
    const d = catalogDivergence([line({ id: 'a', unitPrice: 700 }), line({ id: 'b', unitPrice: 720 })], [pos()]);
    expect(d.differs).toHaveLength(0);
  });

  it('«%» lines and lines at 0 ₴ take no part', () => {
    const d = catalogDivergence([
      line({ id: 'p', name: 'Націнка', unit: 'PERCENT', quantity: 10, unitPrice: 0 }),
      line({ id: 'z', name: 'Безкоштовно', unitPrice: 0 }),
    ], [pos()]);
    expect(d.differs).toHaveLength(0);
    expect(d.missing).toHaveLength(0);
  });

  it('a line the catalog has no name for is «missing», filed under its own trade or the estimate’s', () => {
    const d = catalogDivergence([
      line({ id: 'n', name: 'Демонтаж ламінату', trade: null }),
      line({ id: 'f', name: 'Стяжка', unitPrice: 650 }),
    ], [pos()]);
    expect(d.missing.map((m) => [m.line.name, m.trade])).toEqual([['Демонтаж ламінату', 'FLOORING']]);
  });
});

describe('«Не зараз»', () => {
  beforeEach(() => localStorage.clear());

  it('hides the card until a divergence appears that was not on it', () => {
    const before = catalogDivergence([line()], [pos()]);
    expect(shouldShowCard('e1', before)).toBe(true);
    rememberNotNow('e1', before);
    expect(shouldShowCard('e1', before)).toBe(false);
    // The same set again stays hidden; a new price brings it back.
    expect(shouldShowCard('e1', catalogDivergence([line()], [pos()]))).toBe(false);
    expect(shouldShowCard('e1', catalogDivergence([line({ unitPrice: 710 })], [pos()]))).toBe(true);
  });

  it('is per estimate', () => {
    const d = catalogDivergence([line()], [pos()]);
    rememberNotNow('e1', d);
    expect(shouldShowCard('e2', d)).toBe(true);
  });

  it('shows nothing when there is nothing to say', () => {
    expect(shouldShowCard('e1', { differs: [], missing: [] })).toBe(false);
  });
});
