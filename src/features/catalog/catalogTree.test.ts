import { describe, it, expect } from 'vitest';
import { toTradeTree } from './catalogTree.ts';
import type { CatalogItemResponse } from '@/api/types.ts';

function item(over: Partial<CatalogItemResponse> & { id: string }): CatalogItemResponse {
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

const shape = (items: CatalogItemResponse[]) =>
  toTradeTree(items).map((b) => ({
    key: b.key,
    count: b.count,
    sections: b.sections.map((s) => s.category),
  }));

describe('toTradeTree — trade is a level, and it says which folder belongs to whom', () => {
  it('splits one flat list into a branch per trade', () => {
    expect(
      shape([
        item({ id: 'a', trade: 'PAINTER', category: 'Фарбування', categoryOrder: 20 }),
        item({ id: 'b', trade: 'DRYWALL', category: 'Підготовка', categoryOrder: 5 }),
        item({ id: 'c', trade: 'DRYWALL', category: 'Каркас і обшивка', categoryOrder: 6 }),
      ]),
    ).toEqual([
      { key: 'DRYWALL', count: 2, sections: ['Підготовка', 'Каркас і обшивка'] },
      { key: 'PAINTER', count: 1, sections: ['Фарбування'] },
    ]);
  });

  it('keeps the library sequence INSIDE a branch — «Підготовка» before «Каркас», never alphabetical', () => {
    const [branch] = toTradeTree([
      item({ id: 'a', trade: 'DRYWALL', category: 'Каркас і обшивка', categoryOrder: 60 }),
      item({ id: 'b', trade: 'DRYWALL', category: 'Підготовка', categoryOrder: 10 }),
      item({ id: 'c', trade: 'DRYWALL', category: 'Оздоблення', categoryOrder: 90 }),
    ]);
    expect(branch.sections.map((s) => s.category)).toEqual([
      'Підготовка',
      'Каркас і обшивка',
      'Оздоблення',
    ]);
  });

  it('a folder the library ships nothing for has no rank and sorts LAST, inside its branch', () => {
    const [branch] = toTradeTree([
      item({ id: 'mine', trade: 'DRYWALL', category: 'Моє', categoryOrder: null }),
      item({ id: 'lib', trade: 'DRYWALL', category: 'Підготовка', categoryOrder: 10 }),
    ]);
    expect(branch.sections.map((s) => s.category)).toEqual(['Підготовка', 'Моє']);
  });

  it('shows a shared position under BOTH trades, each in that trade’s own folder', () => {
    const tree = toTradeTree([
      item({
        id: 'hatch',
        name: 'Установка люка-ревізії',
        trade: 'PLUMBING',
        category: 'Сантехнічні прилади',
        categoryOrder: 100,
        sharedTrades: [{ trade: 'DRYWALL', category: 'Каркас і обшивка', categoryOrder: 60 }],
      }),
      item({ id: 'd1', trade: 'DRYWALL', category: 'Підготовка', categoryOrder: 10 }),
    ]);

    // Drywall leads: a branch sits where its FIRST folder already sat (rank 10 vs plumbing's 100).
    expect(tree.map((b) => b.key)).toEqual(['DRYWALL', 'PLUMBING']);
    const drywall = tree.find((b) => b.key === 'DRYWALL');
    expect(drywall?.count).toBe(2);
    expect(drywall?.sections.map((s) => s.category)).toEqual(['Підготовка', 'Каркас і обшивка']);
    // Same row, same id — ticking either copy ticks the position once.
    expect(drywall?.sections[1].items[0].id).toBe('hatch');
    expect(tree.find((b) => b.key === 'PLUMBING')?.count).toBe(1);
  });

  it('never invents a branch for a trade the master does not have', () => {
    // The LIBRARY ships this name under plumbing too; his catalog holds no plumbing row.
    expect(
      shape([
        item({
          id: 'hatch',
          trade: 'DRYWALL',
          category: 'Каркас і обшивка',
          categoryOrder: 60,
          sharedTrades: [{ trade: 'PLUMBING', category: 'Сантехнічні прилади', categoryOrder: 100 }],
        }),
      ]),
    ).toEqual([{ key: 'DRYWALL', count: 1, sections: ['Каркас і обшивка'] }]);
  });

  it('a custom trade is its own branch, never merged into «Інше» and never lending rows away', () => {
    const tree = toTradeTree([
      item({ id: 'p', trade: 'PAINTER', category: 'Фарбування', categoryOrder: 20 }),
      item({ id: 'o', trade: 'OTHER', category: 'Різне', categoryOrder: 900 }),
      item({
        id: 'c',
        trade: 'OTHER',
        customTradeId: 'ct1',
        customTradeName: 'Кавові апарати',
        category: 'Різне',
        categoryOrder: 900,
        sharedTrades: [{ trade: 'PAINTER', category: 'Фарбування', categoryOrder: 20 }],
      }),
    ]);

    expect(tree.map((b) => b.key)).toEqual(['PAINTER', 'OTHER', 'custom:ct1']);
    expect(tree.map((b) => b.count)).toEqual([1, 1, 1]);
    expect(tree[2].customName).toBe('Кавові апарати');
  });

  it('an untagged row lands in OTHER, so nothing can fall out of the tree', () => {
    expect(shape([item({ id: 'x', trade: null, category: null })])).toEqual([
      { key: 'OTHER', count: 1, sections: [''] },
    ]);
  });
});

describe('toTradeTree — every row remembers the branch it is shown in', () => {
  const rowsOf = (tree: ReturnType<typeof toTradeTree>) =>
    tree.flatMap((b) => b.sections.flatMap((s) => s.items.map((i) => [b.key, i.id, i.filedUnder])));

  /**
   * A shared position is stored once, under whichever trade claimed the name first (V118), and is
   * shown under every trade that ships it. Which COPY was tapped is the only evidence of which
   * work the master meant — the server files the estimate line by it, so the two copies must not
   * answer the same thing.
   */
  it('a shared position answers with the branch, not with where it is stored', () => {
    const tree = toTradeTree([
      item({
        id: 'shared',
        trade: 'DRYWALL',
        category: 'Оздоблення під фарбування',
        categoryOrder: 30,
        sharedTrades: [{ trade: 'PAINTER', category: 'Шпаклювання та шліфування', categoryOrder: 15 }],
      }),
      item({ id: 'anchor', trade: 'PAINTER', category: 'Фарбування', categoryOrder: 20 }),
    ]);

    expect(rowsOf(tree)).toEqual(
      expect.arrayContaining([
        ['DRYWALL', 'shared', 'DRYWALL'],
        ['PAINTER', 'shared', 'PAINTER'],
      ]),
    );
  });

  /** A custom trade has no enum value to send, and needs none — the row is his own filing. */
  it('a custom-trade branch answers null', () => {
    const tree = toTradeTree([
      item({ id: 'c', trade: 'OTHER', customTradeId: 'ct1', customTradeName: 'Каміни' }),
    ]);

    expect(rowsOf(tree)).toEqual([['custom:ct1', 'c', null]]);
  });
});
