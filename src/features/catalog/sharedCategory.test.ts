import { describe, it, expect } from 'vitest';
import { asSelectedTradeSees } from './sharedCategory.ts';
import type { CatalogItemResponse } from '@/api/types.ts';
import { customTradeKey, type TradeKey } from './TradeFilterChips.tsx';

function item(partial: Partial<CatalogItemResponse>): CatalogItemResponse {
  return {
    id: partial.id ?? 'i1',
    name: partial.name ?? 'Поклейка склополотна',
    category: partial.category ?? null,
    description: null,
    trade: partial.trade ?? 'PAINTER',
    customTradeId: partial.customTradeId ?? null,
    customTradeName: null,
    type: 'WORK',
    unit: 'M2',
    defaultPrice: 160,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
    sharedTrades: partial.sharedTrades ?? [],
  };
}

/** Stored under PAINTER as «Шпалери»; DRYWALL ships the same wording as a finishing phase. */
const WALLPAPER = item({
  category: 'Шпалери',
  trade: 'PAINTER',
  sharedTrades: [{ trade: 'DRYWALL', category: 'Оздоблення під фарбування' }],
});

const own = (keys: TradeKey[]) => new Set<TradeKey>(keys);

describe('asSelectedTradeSees', () => {
  it('shows a shared row under the selected trade own category', () => {
    // «що тут робить категорія Шпалери?» — asked about the drywall chip.
    expect(asSelectedTradeSees([WALLPAPER], own(['DRYWALL']))[0].category)
      .toBe('Оздоблення під фарбування');
  });

  it('leaves the stored category alone under the row own trade', () => {
    expect(asSelectedTradeSees([WALLPAPER], own(['PAINTER']))[0].category).toBe('Шпалери');
  });

  it('leaves the stored category alone when nothing or several trades are selected', () => {
    // With no filter there is no single answer to "whose category?", and the stored one is where
    // the master himself put the row.
    expect(asSelectedTradeSees([WALLPAPER], own([]))[0].category).toBe('Шпалери');
    expect(asSelectedTradeSees([WALLPAPER], own(['DRYWALL', 'PAINTER']))[0].category)
      .toBe('Шпалери');
  });

  it('ignores a custom-trade selection', () => {
    expect(asSelectedTradeSees([WALLPAPER], own([customTradeKey('ct1')]))[0].category)
      .toBe('Шпалери');
  });

  it('leaves a row the selected trade does not share', () => {
    const plain = item({ id: 'i2', name: 'Фарбування стін', category: 'Фарбування' });
    expect(asSelectedTradeSees([plain], own(['DRYWALL']))[0]).toBe(plain);
  });

  it('returns the same object when nothing moves, so memoized renders stay cheap', () => {
    expect(asSelectedTradeSees([WALLPAPER], own(['PAINTER']))[0]).toBe(WALLPAPER);
  });
});
