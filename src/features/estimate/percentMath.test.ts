import { describe, it, expect } from 'vitest';
import '@/lib/i18n.ts';
import { percentLabel } from './percentLine.ts';
import type { EstimateItemResponse } from '@/api/types.ts';

/**
 * The client's half of «%» — the wording, and the mirror of the server's three-step pass.
 *
 * The arithmetic itself lives in `useEstimate.recomputeLines`, which is not exported; what IS
 * exported and worth pinning here is the wording, because it is the one thing a CLIENT reads on the
 * portal and in the PDF. «10 % · 500 ₴/%» — five hundred hryvnia for one percent — is what this
 * replaced, and a figure a client cannot trace is a figure he will not sign.
 */
const line = (over: Partial<EstimateItemResponse> = {}): EstimateItemResponse => ({
  id: 'i1', type: 'WORK', name: 'Позиція', category: null, unit: 'M2',
  quantity: 1, unitPrice: 100, lineTotal: 100, sortOrder: 0,
  measurementRefs: [], quantityManual: false,
  percentBaseKind: null, percentBaseItemId: null, baseDetached: false, baseOriginLabel: null, closedByActs: null,
  ...over,
});

describe('how a percentage line reads', () => {
  it('says nothing for an ordinary line, so the price-per-unit branch is untouched', () => {
    expect(percentLabel(line(), new Map())).toBeNull();
  });

  it('names the sum for a hand-typed base', () => {
    const item = line({ unit: 'PERCENT', quantity: 10, unitPrice: 500, percentBaseKind: 'MANUAL' });
    expect(percentLabel(item, new Map())).toContain('500');
  });

  it('names the LINE it is measured against', () => {
    const wardrobe = line({ id: 'base', name: 'Шафа', lineTotal: 1000 });
    const delivery = line({
      id: 'd', unit: 'PERCENT', quantity: 10,
      percentBaseKind: 'POSITION', percentBaseItemId: 'base',
    });

    expect(percentLabel(delivery, new Map([['base', wardrobe]]))).toContain('Шафа');
  });

  it('says the base is gone rather than showing a percentage of nothing', () => {
    // The amount itself stays — the master is charging for this work, and zeroing it because the
    // base was deleted would be data loss dressed up as tidiness.
    const orphan = line({
      unit: 'PERCENT', quantity: 10, lineTotal: 100,
      percentBaseKind: 'POSITION', percentBaseItemId: 'gone',
    });

    expect(percentLabel(orphan, new Map())).toMatch(/видалена/);
  });

  it('names the estimate for a percentage of the total', () => {
    const transport = line({ unit: 'PERCENT', quantity: 20, percentBaseKind: 'TOTAL' });
    expect(percentLabel(transport, new Map())).toMatch(/кошторис/);
  });

  it('shows the frozen provenance snapshot verbatim for a consolidated line, not the MANUAL wording', () => {
    // A consolidated line is always kind=MANUAL (frozen), so without the baseOriginLabel
    // branch this would read the generic "% від {reconstructed sum}" — a number nobody can
    // place — instead of naming the source estimate.
    const frozen = line({
      unit: 'PERCENT', quantity: -15, unitPrice: 1000, percentBaseKind: 'MANUAL',
      baseDetached: true, baseOriginLabel: '-15% від робіт · кошторис «Квартира — чорнові»',
    });

    expect(percentLabel(frozen, new Map())).toBe('-15% від робіт · кошторис «Квартира — чорнові»');
  });

  it('never says «₴/%» — the wording this whole feature exists to remove', () => {
    const kinds = ['MANUAL', 'POSITION', 'TOTAL'] as const;
    for (const kind of kinds) {
      const label = percentLabel(
        line({ unit: 'PERCENT', quantity: 10, percentBaseKind: kind }),
        new Map(),
      );
      expect(label).not.toContain('₴/%');
    }
  });
});
