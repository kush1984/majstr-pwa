import type { EstimateItemRequest, EstimateItemResponse } from '@/api/types.ts';
import { roundMoney } from '@/lib/decimal.ts';

/**
 * Editing one field of an estimate line from the row. The server takes the WHOLE line on every
 * update (`PUT …/items/{id}`), so a cell sends the line exactly as it stands with one field
 * changed. No crew price travels: `EstimateItemRequest` has no such field, by construction.
 */
export function itemRequest(item: EstimateItemResponse, patch: Partial<EstimateItemRequest> = {}): EstimateItemRequest {
  return {
    type: item.type,
    name: item.name,
    category: item.category ?? undefined,
    unit: item.unit,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    sortOrder: item.sortOrder,
    measurementRefs: item.measurementRefs,
    quantityManual: item.quantityManual,
    percentBaseKind: item.percentBaseKind,
    percentBaseItemId: item.percentBaseItemId,
    ...patch,
  };
}

/** A typed quantity. On a line measured from the object's measurements it becomes MANUAL — the
 *  server would otherwise recompute it from the measurements and throw the typed figure away. */
export function quantityPatch(item: EstimateItemResponse, quantity: number): Partial<EstimateItemRequest> {
  return item.measurementRefs.length > 0 ? { quantity, quantityManual: true } : { quantity };
}

/** Whether the row should say «✎ вручну»: a typed quantity on a line that has measurements. */
export function isManualOverMeasurements(item: EstimateItemResponse): boolean {
  return item.quantityManual && item.measurementRefs.length > 0;
}

/** A «%» line edits the MAGNITUDE; the sign (a discount is negative) stays as it was. */
export function percentPatch(item: EstimateItemResponse, magnitude: number): Partial<EstimateItemRequest> {
  return { quantity: item.quantity < 0 ? -magnitude : magnitude };
}

export type SumEdit =
  /** The quantity is 0: a sum cannot be spread over nothing. */
  | { kind: 'noQuantity' }
  /** Price = sum / quantity at the kopeck; `actual` is what that price really adds up to. */
  | { kind: 'price'; price: number; actual: number; exact: boolean };

/**
 * A typed SUM becomes a PRICE: sum / quantity, rounded to the kopeck. We do not believe a sum that
 * price × quantity cannot give — 11 500 over 17,1 is 672,51, which is 11 499,92, and that honest
 * figure is what is stored; `exact: false` is what offers «Округлити ціну».
 */
export function sumEdit(sum: number, quantity: number): SumEdit {
  if (quantity <= 0) return { kind: 'noQuantity' };
  const price = roundMoney(sum / quantity);
  const actual = roundMoney(price * quantity);
  return { kind: 'price', price, actual, exact: actual === roundMoney(sum) };
}

/** «Округлити ціну»: the nearest whole-hryvnia price for the typed sum. */
export function roundedPrice(sum: number, quantity: number): number {
  return quantity > 0 ? Math.round(sum / quantity) : 0;
}
