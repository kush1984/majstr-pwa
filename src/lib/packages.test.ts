import { describe, expect, it } from 'vitest';
import { packageCount } from './packages.ts';

describe('packageCount', () => {
  it('rounds up to a whole package', () => {
    expect(packageCount(150.001, 25)).toBe(7);
    expect(packageCount(0.3, 25)).toBe(1);
  });

  it('is exact on a whole division, float noise included', () => {
    expect(packageCount(150, 25)).toBe(6);
    // 2.1 / 0.3 is 7.000000000000001 in binary floating point — still 7, never 8.
    expect(packageCount(2.1, 0.3)).toBe(7);
  });

  it('a remainder just past the tolerance still buys another package', () => {
    expect(packageCount(25 + 1e-6, 25)).toBe(2);
  });

  it('has nothing to count without a package or a positive quantity', () => {
    expect(packageCount(0, 25)).toBeNull();
    expect(packageCount(-5, 25)).toBeNull();
    expect(packageCount(Number.NaN, 25)).toBeNull();
    expect(packageCount(150, 0)).toBeNull();
    expect(packageCount(150, null)).toBeNull();
    expect(packageCount(150, undefined)).toBeNull();
    expect(packageCount(null, 25)).toBeNull();
  });
});
