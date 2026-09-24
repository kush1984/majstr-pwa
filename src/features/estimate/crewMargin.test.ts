import { describe, it, expect } from 'vitest';
import { crewMarginOf } from './crewMargin.ts';
import type { EstimateItemResponse, EstimateResponse } from '@/api/types.ts';

function line(over: Partial<EstimateItemResponse> & { id: string }): EstimateItemResponse {
  return {
    type: 'WORK', name: over.id, category: null, unit: 'M2',
    quantity: 0, unitPrice: 0, lineTotal: 0, sortOrder: 0,
    measurementRefs: [], quantityManual: false,
    percentBaseKind: null, percentBaseItemId: null, baseDetached: false,
    baseOriginLabel: null, closedByActs: null,
    ...over,
  };
}

function estimate(items: EstimateItemResponse[]): EstimateResponse {
  return {
    id: 'e1', projectId: 'p1', name: null, status: 'DRAFT', validUntil: null, notes: null,
    createdAt: '', updatedAt: '', items,
    worksSubtotal: 0, materialsSubtotal: 0, total: 0, balance: 0,
    // The server's verdict that this IS a markup copy. `marginAccepted` is carried through.
    crewMargin: { crewTotal: 0, margin: 0, marginAccepted: 1600, unpricedCount: 0, unpricedTotal: 0 },
  };
}

describe('crewMarginOf — the mirror of the backend CrewMarginCalculator', () => {
  /**
   * THE PARITY FIXTURE. The same three lines are asserted to the same two figures in
   * `CrewMarginIntegrationTest` on the backend: a м² line, a «% від кошторису» surcharge that has
   * to be re-measured against the crew's own subtotal, and a line added afterwards with no crew
   * price. Change one side and this comment is the reason to change the other.
   */
  it('agrees with the backend on the shared fixture', () => {
    const est = estimate([
      line({ id: 'a', quantity: 100, unitPrice: 300, lineTotal: 30000, sourceUnitPrice: 200 }),
      line({ id: 'b', unit: 'PERCENT', quantity: 10, unitPrice: 0, lineTotal: 3000,
             percentBaseKind: 'TOTAL', sourceUnitPrice: 10 }),
      line({ id: 'c', quantity: 10, unitPrice: 500, lineTotal: 5000 }),
    ]);

    const margin = crewMarginOf(est)!;

    // Crew: 100 × 200 = 20 000 + line c unchanged at the client's 5 000 = 25 000, +10 % = 27 500.
    expect(margin.crewTotal).toBe(27500);
    // Client: 30 000 + 5 000 = 35 000, +10 % = 38 500. Margin 11 000 — and NOTHING of it comes
    // from line c: it enters BOTH views identically (its own 5 000 and the 500 the surcharge adds
    // on top of it), so it cancels in the subtraction. That is what «contributes zero» means for a
    // line that also sits inside a percentage's base.
    expect(margin.margin).toBe(11000);
    expect(margin.unpricedCount).toBe(1);
    expect(margin.unpricedTotal).toBe(5000);
  });

  it('carries marginAccepted through from the server — the editor cannot know it', () => {
    const est = estimate([line({ id: 'a', quantity: 1, unitPrice: 100, lineTotal: 100, sourceUnitPrice: 80 })]);

    expect(crewMarginOf(est)!.marginAccepted).toBe(1600);
  });

  /** Eligibility is the server's call: no figure from it means this is not a markup copy. */
  it('answers nothing when the server sent no margin', () => {
    const est = { ...estimate([]), crewMargin: null };

    expect(crewMarginOf(est)).toBeNull();
  });

  /** A price raised after duplicating is real margin — the copy is the client's sheet. */
  it('follows a price edited in the copy', () => {
    const est = estimate([
      line({ id: 'a', quantity: 10, unitPrice: 500, lineTotal: 5000, sourceUnitPrice: 200 }),
    ]);

    const margin = crewMarginOf(est)!;
    expect(margin.crewTotal).toBe(2000);
    expect(margin.margin).toBe(3000);
  });
});
