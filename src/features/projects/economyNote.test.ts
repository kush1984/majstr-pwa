import { describe, it, expect } from 'vitest';
import { economyPairHint } from './economyNote.ts';

describe('economy hint on an estimate row', () => {
  it('explains the markup on a marked-up copy', () => {
    expect(economyPairHint({ markupPercent: 15 }, false)).toBe('estimate.duplicateMarkupHint');
  });

  it('explains the discount on a discounted copy (signed negative percent)', () => {
    expect(economyPairHint({ markupPercent: -15 }, false)).toBe('estimate.duplicateDiscountHint');
  });

  it('explains the empty box on the estimate a copy was made from', () => {
    expect(economyPairHint({ markupPercent: null }, true)).toBe('estimate.crewPricesHint');
  });

  it('says nothing on an ordinary estimate', () => {
    // No pair, nothing to explain — a hint under every row would be noise.
    expect(economyPairHint({ markupPercent: null }, false)).toBeNull();
  });

  it('prefers the copy hint when an estimate is both a copy and a source', () => {
    // A copy of a copy: what THIS row contributes is its own markup, so that reading wins.
    expect(economyPairHint({ markupPercent: 10 }, true)).toBe('estimate.duplicateMarkupHint');
  });
});
