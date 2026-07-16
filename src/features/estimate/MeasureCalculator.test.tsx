import { describe, it, expect } from 'vitest';
import { openingsAreaM2, sumLengths } from './MeasureCalculator.tsx';

// The area maths itself lives in `@/lib/shapes` (shapes.test.ts) — the calculator only
// adds the length mode and the openings it subtracts.

describe('sumLengths', () => {
  it('sums the lengths (accepts comma decimals)', () => {
    expect(sumLengths([{ l: '1,2' }, { l: '2,36' }], 'M')).toBe(3.56);
  });

  it('converts to metres', () => {
    expect(sumLengths([{ l: '120' }, { l: '236' }], 'CM')).toBe(3.56);
  });

  it('treats empty / garbage as zero', () => {
    expect(sumLengths([{ l: '' }, { l: 'abc' }], 'M')).toBe(0);
  });
});

describe('openingsAreaM2', () => {
  it('multiplies w × h × count', () => {
    expect(openingsAreaM2([{ w: '2', h: '2', n: '1' }], 'M')).toBe(4);
    expect(openingsAreaM2([{ w: '1', h: '1', n: '3' }], 'M')).toBe(3);
  });

  it('treats a blank count as 1', () => {
    expect(openingsAreaM2([{ w: '1', h: '2', n: '' }], 'M')).toBe(2);
  });

  it('converts to m² with the chosen unit', () => {
    expect(openingsAreaM2([{ w: '90', h: '140', n: '1' }], 'CM')).toBe(1.26);
  });
});
