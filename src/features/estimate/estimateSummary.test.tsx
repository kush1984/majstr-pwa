import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/lib/i18n.ts';
import { TypeBreakdown, adjustTotals } from './EstimateEditorPage.tsx';
import type { EstimateItemResponse } from '@/api/types.ts';

/**
 * The dark summary panel's handling of FROZEN (consolidated-rollup) percent lines — the
 * follow-up to the provenance fix: one word per sign instead of a single ambiguous
 * "Перенесені знижки/надбавки" row, and the same recap under «До сплати» a plain estimate
 * already gets for its live «% від кошторису» lines.
 */
function line(over: Partial<EstimateItemResponse>): EstimateItemResponse {
  return {
    id: 'x', type: 'WORK', name: 'Позиція', category: null, unit: 'M2',
    quantity: 1, unitPrice: 100, lineTotal: 100, sortOrder: 0,
    measurementRefs: [], quantityManual: false,
    percentBaseKind: null, percentBaseItemId: null, baseDetached: false, baseOriginLabel: null, closedByActs: null,
    ...over,
  };
}

describe('TypeBreakdown — frozen consolidated lines, one word per sign', () => {
  it('shows a discount row when the frozen contribution is negative', () => {
    const items = [
      line({ id: 'w1', lineTotal: 1000 }),
      line({
        id: 'f1', unit: 'PERCENT', quantity: -15, lineTotal: -150, percentBaseKind: 'MANUAL',
        baseOriginLabel: '-15% від робіт · кошторис «Кошторис від 6 липня»',
      }),
    ];
    render(<TypeBreakdown items={items} type="WORK" subtotal={850} label="Роботи" />);

    expect(screen.getByText('Перенесені знижки')).toBeTruthy();
    expect(screen.queryByText('Перенесені надбавки')).toBeNull();
  });

  it('shows a markup row when the frozen contribution is positive', () => {
    const items = [
      line({ id: 'm1', type: 'MATERIAL', lineTotal: 1000 }),
      line({
        id: 'f1', type: 'MATERIAL', unit: 'PERCENT', quantity: 20, lineTotal: 200,
        percentBaseKind: 'MANUAL', baseOriginLabel: '+20% від «Шафа» · кошторис «Санвузол»',
      }),
    ];
    render(<TypeBreakdown items={items} type="MATERIAL" subtotal={1200} label="Матеріали" />);

    expect(screen.getByText('Перенесені надбавки')).toBeTruthy();
    expect(screen.queryByText('Перенесені знижки')).toBeNull();
  });

  it('shows BOTH rows when the same type carries a frozen discount and a frozen markup', () => {
    const items = [
      line({ id: 'w1', lineTotal: 1000 }),
      line({
        id: 'f1', unit: 'PERCENT', quantity: -10, lineTotal: -100, percentBaseKind: 'MANUAL',
        baseOriginLabel: '-10% від робіт · кошторис «А»',
      }),
      line({
        id: 'f2', unit: 'PERCENT', quantity: 5, lineTotal: 50, percentBaseKind: 'MANUAL',
        baseOriginLabel: '+5% від робіт · кошторис «Б»',
      }),
    ];
    render(<TypeBreakdown items={items} type="WORK" subtotal={950} label="Роботи" />);

    expect(screen.getByText('Перенесені знижки')).toBeTruthy();
    expect(screen.getByText('Перенесені надбавки')).toBeTruthy();
  });

  it('shows neither row when nothing is frozen (an ordinary estimate)', () => {
    const items = [line({ id: 'w1', lineTotal: 1000 })];
    render(<TypeBreakdown items={items} type="WORK" subtotal={1000} label="Роботи" />);

    expect(screen.queryByText('Перенесені знижки')).toBeNull();
    expect(screen.queryByText('Перенесені надбавки')).toBeNull();
  });
});

describe('adjustTotals — reused recap under «До сплати» now also folds in frozen lines', () => {
  it('is a no-op for a plain estimate with no frozen lines (existing TOTAL-only behaviour)', () => {
    const items = [
      line({ id: 'w1', lineTotal: 1000 }),
      line({ id: 'p1', unit: 'PERCENT', quantity: 15, lineTotal: 150, percentBaseKind: 'TOTAL' }),
    ];
    expect(adjustTotals(items)).toEqual({ markup: 150, discount: 0 });
  });

  it('adds a frozen contribution to the same markup/discount buckets', () => {
    const items = [
      line({ id: 'w1', lineTotal: 1000 }),
      line({
        id: 'f1', unit: 'PERCENT', quantity: -12, lineTotal: -120, percentBaseKind: 'MANUAL',
        baseOriginLabel: '-12% від робіт · кошторис «Х»',
      }),
    ];
    expect(adjustTotals(items)).toEqual({ markup: 0, discount: -120 });
  });
});
