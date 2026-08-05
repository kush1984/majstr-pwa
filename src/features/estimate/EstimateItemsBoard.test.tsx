import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/lib/i18n.ts';
import { EstimateItemsBoard } from './EstimateItemsBoard.tsx';
import type { EstimateItemResponse } from '@/api/types.ts';

/**
 * Position numbers, asked for by a master: «Було б добре коли складаєш кошторис ти зліва
 * нумерацію позицій для звірки їх кількості».
 *
 * The reason he gave is the specification. He is not decorating the list — he is counting it,
 * against a list he made on site, so the numbering has to run through the WHOLE estimate. A
 * count that restarts inside every category cannot be checked against anything.
 */
const item = (id: string, name: string, category: string, sortOrder: number): EstimateItemResponse => ({
  id, type: 'WORK', name, category, unit: 'M2',
  quantity: 1, unitPrice: 100, lineTotal: 100, sortOrder,
  measurementRefs: [], quantityManual: false, percentBaseKind: null, percentBaseItemId: null, baseDetached: false,
});

function renderBoard(items: EstimateItemResponse[]) {
  return render(
    <EstimateItemsBoard items={items} signed={false} onEdit={() => {}} onArrange={() => {}} />,
  );
}

describe('position numbering', () => {
  it('runs straight through the categories instead of restarting in each', () => {
    renderBoard([
      item('a', 'Ґрунтівка', 'Підготовчі роботи', 0),
      item('b', 'Штукатурка', 'Підготовчі роботи', 1),
      item('c', 'Укладання плитки', 'Укладання плитки', 2),
      item('d', 'Затирання швів', 'Укладання плитки', 3),
      item('e', 'Прибирання', 'Організаційні послуги', 4),
    ]);

    // The point of the feature: the LAST number equals how many positions there are, so the
    // master can check his count in one glance. Per-category numbering would end at «1».
    expect(screen.getByText('5.')).toBeTruthy();
    expect(screen.queryAllByText('1.')).toHaveLength(1);
    for (const n of ['1.', '2.', '3.', '4.', '5.']) {
      expect(screen.getByText(n)).toBeTruthy();
    }
  });

  it('numbers by the order shown, not by the order the lines arrived in', () => {
    // sortOrder is what the master arranged by dragging; the array order is incidental.
    renderBoard([
      item('late', 'Друга', '', 1),
      item('early', 'Перша', '', 0),
    ]);

    const rows = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(rows.find((r) => r.includes('Перша'))).toMatch(/^1/);
    expect(rows.find((r) => r.includes('Друга'))).toMatch(/^2/);
  });

  it('keeps the number in its own column when a long name wraps', () => {
    // The first attempt put the number inside the name's text flow, so a wrapping name — most of
    // them on a phone — sent its second line back under the number and the column stopped being a
    // column. The number must be a SIBLING of the name, never part of its text.
    renderBoard([
      item('x', 'Укладання декоративної плитки під «цеглу» або «камінь» (гіпсова, бетонна)', '', 0),
    ]);

    const number = screen.getByText('1.');
    const name = screen.getByText(/Укладання декоративної/);
    expect(number.contains(name)).toBe(false);
    expect(name.contains(number)).toBe(false);
  });
});
