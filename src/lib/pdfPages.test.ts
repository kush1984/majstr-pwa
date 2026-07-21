import { describe, it, expect } from 'vitest';
import { parsePageRange } from './pdfPages.ts';

describe('parsePageRange', () => {
  it('parses single pages, ranges and lists; sorts + dedupes; clamps to [1,max]', () => {
    expect(parsePageRange('3', 10)).toEqual([3]);
    expect(parsePageRange('3-5', 10)).toEqual([3, 4, 5]);
    expect(parsePageRange('5-3', 10)).toEqual([3, 4, 5]); // reversed range ok
    expect(parsePageRange('1,3,5', 10)).toEqual([1, 3, 5]);
    expect(parsePageRange('2-3, 3, 7', 10)).toEqual([2, 3, 7]); // dedupe overlap
    expect(parsePageRange('0, 4, 99', 10)).toEqual([4]); // clamp out-of-range
    expect(parsePageRange('', 10)).toEqual([]);
    expect(parsePageRange('abc', 10)).toEqual([]);
  });
});
