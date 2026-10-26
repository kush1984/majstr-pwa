import { describe, it, expect } from 'vitest';
import type { EstimateItemResponse } from '@/api/types.ts';
import {
  isManualOverMeasurements, itemRequest, percentPatch, quantityPatch, roundedPrice, sumEdit,
} from './inlineItem.ts';

function line(over: Partial<EstimateItemResponse> = {}): EstimateItemResponse {
  return {
    id: 'i1', type: 'WORK', name: 'Укладання плитки 300×600', category: 'Плитка', unit: 'M2',
    quantity: 17.1, unitPrice: 650, lineTotal: 11115, sortOrder: 4, measurementRefs: [],
    quantityManual: false, percentBaseKind: null, percentBaseItemId: null, baseDetached: false,
    sourceUnitPrice: 520,
    ...over,
  } as EstimateItemResponse;
}

describe('itemRequest', () => {
  it('sends the line as it stands with one field changed — and never a crew price', () => {
    const req = itemRequest(line(), { unitPrice: 700 });
    expect(req).toMatchObject({ name: 'Укладання плитки 300×600', quantity: 17.1, unitPrice: 700, sortOrder: 4 });
    expect(Object.keys(req)).not.toContain('sourceUnitPrice');
  });
});

describe('quantityPatch', () => {
  it('a typed quantity on a measured line becomes manual', () => {
    expect(quantityPatch(line({ measurementRefs: ['m1'] }), 20)).toEqual({ quantity: 20, quantityManual: true });
    expect(isManualOverMeasurements(line({ measurementRefs: ['m1'], quantityManual: true }))).toBe(true);
  });

  it('a line without measurements just takes the number', () => {
    expect(quantityPatch(line(), 20)).toEqual({ quantity: 20 });
    expect(isManualOverMeasurements(line({ quantityManual: true }))).toBe(false);
  });
});

describe('percentPatch', () => {
  it('edits the magnitude and keeps the sign of a discount', () => {
    expect(percentPatch(line({ unit: 'PERCENT', quantity: -15 }), 20)).toEqual({ quantity: -20 });
    expect(percentPatch(line({ unit: 'PERCENT', quantity: 10 }), 12.5)).toEqual({ quantity: 12.5 });
  });
});

describe('sumEdit', () => {
  it('turns a sum into a price at the kopeck and reports the honest total', () => {
    expect(sumEdit(11500, 17.1)).toEqual({ kind: 'price', price: 672.51, actual: 11499.92, exact: false });
  });

  it('is exact when the price divides cleanly', () => {
    expect(sumEdit(11115, 17.1)).toEqual({ kind: 'price', price: 650, actual: 11115, exact: true });
  });

  it('refuses a sum over a zero quantity', () => {
    expect(sumEdit(1000, 0)).toEqual({ kind: 'noQuantity' });
  });

  it('«Округлити ціну» offers the nearest whole hryvnia', () => {
    expect(roundedPrice(11500, 17.1)).toBe(673);
  });
});
