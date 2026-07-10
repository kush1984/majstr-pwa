import { describe, it, expect } from 'vitest';
import { computeMeasure } from './MeasureCalculator.tsx';

describe('computeMeasure', () => {
  it('area = length × width (like the Excel 5.31 × 3.69)', () => {
    expect(computeMeasure('area', [{ l: '5.31', w: '3.69' }], [])).toBe(19.594);
  });

  it('area sums multiple segments (accepts comma decimals)', () => {
    // 2.71×3.44 + 3.69×4.14 = 9.3224 + 15.2766 = 24.599 (rounded to 3 dp)
    expect(
      computeMeasure('area', [{ l: '2,71', w: '3,44' }, { l: '3,69', w: '4,14' }], []),
    ).toBe(24.599);
  });

  it('area subtracts openings (w × h × count; blank count = 1)', () => {
    expect(computeMeasure('area', [{ l: '4', w: '3' }], [{ w: '2', h: '2', n: '1' }])).toBe(8);
    expect(computeMeasure('area', [{ l: '4', w: '3' }], [{ w: '1', h: '2', n: '' }])).toBe(10);
    expect(computeMeasure('area', [{ l: '10', w: '3' }], [{ w: '1', h: '1', n: '3' }])).toBe(27);
  });

  it('length sums the lengths and ignores width + openings', () => {
    expect(
      computeMeasure('length', [{ l: '1,2', w: '99' }, { l: '2,36', w: '99' }], [{ w: '5', h: '5', n: '5' }]),
    ).toBe(3.56);
  });

  it('never goes negative when openings exceed the area', () => {
    expect(computeMeasure('area', [{ l: '2', w: '1' }], [{ w: '5', h: '5', n: '1' }])).toBe(0);
  });

  it('treats empty / garbage inputs as zero', () => {
    expect(computeMeasure('area', [{ l: '', w: '' }], [])).toBe(0);
    expect(computeMeasure('area', [{ l: 'abc', w: '3' }], [])).toBe(0);
  });
});
