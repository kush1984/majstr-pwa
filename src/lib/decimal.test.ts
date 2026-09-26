import { describe, it, expect } from 'vitest';
import { markedUpPrice, parseMoney, parseQuantity, roundMoney, sumMoney } from './decimal.ts';

/**
 * The mirror of `EstimateService.markedUp` (review B-47). The offline editor prices a duplicate on
 * the device and the server prices it again on sync; the two disagreeing about a client's price is
 * the one thing neither side may do.
 */
describe('markedUpPrice', () => {
  it('keeps the kopecks — they are the whole bug on a cheap position', () => {
    // 0,40 ₴ +20 % used to round to 0,00, so 2 000 pcs were billed NOTHING instead of 960 ₴.
    expect(markedUpPrice(0.4, 1.2)).toBe(0.48);
    expect(markedUpPrice(1.2, 1.15)).toBe(1.38);
    expect(markedUpPrice(333, 1.15)).toBe(382.95);
    expect(markedUpPrice(350, 0.85)).toBe(297.5);
  });

  it('never prices a position that COSTS money at nothing', () => {
    // Scale 2 alone cannot reach zero from a stored price — a deep discount copy can, and a
    // 0,00 ₴ line in a signed document is a promise to work for free.
    expect(markedUpPrice(0.01, 0.1)).toBe(0.01);
    expect(markedUpPrice(0, 1.2)).toBe(0);
  });
});

describe('roundMoney', () => {
  it('rounds HALF_UP away from zero, through the float that trips Math.round', () => {
    expect(roundMoney(382.94999999999993)).toBe(382.95);
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(-1.005)).toBe(-1.01);
  });
});

describe('sumMoney', () => {
  it('adds in kopecks, so a long total does not drift', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([2.5 * 10.25])).toBe(25.63); // the line the review measured: 51,26 over two
    expect(sumMoney([])).toBe(0);
  });
});

/**
 * Review P-35. The old reader was `Number(s.replace(',', '.'))` falling back to 0, so a figure
 * nobody typed reached signed documents: «1 200» became 0 ₴, «12а» became 0 ₴, and an
 * additional-work line was signed as free.
 */
describe('parseMoney', () => {
  it('reads what a master actually types, grouping spaces and all', () => {
    expect(parseMoney('1 200')).toBe(1200);
    expect(parseMoney('1 200,50')).toBe(1200.5);
    expect(parseMoney('1 200')).toBe(1200);
    expect(parseMoney("1'200")).toBe(1200);
    expect(parseMoney('12,5')).toBe(12.5);
    expect(parseMoney('  350  ')).toBe(350);
  });

  it('answers null rather than zero on everything it cannot read', () => {
    for (const raw of ['', '12а', '-5', '−5', '1.200,50', '12.345', '0,004', '1e5', '0x10',
      'Infinity', 'NaN', '100000000', ',5', '1,2,3']) {
      expect(parseMoney(raw), raw).toBeNull();
    }
  });

  it('takes zero only where zero is a real answer', () => {
    // An unpriced act receipt is a legal intermediate state (receipts-batch); an act line is not.
    expect(parseMoney('0')).toBeNull();
    expect(parseMoney('0', { allowZero: true })).toBe(0);
    expect(parseMoney('0,00', { allowZero: true })).toBe(0);
  });
});

describe('parseQuantity', () => {
  it('carries three decimals — the server scale — and refuses a fourth', () => {
    expect(parseQuantity('2,555')).toBe(2.555);
    expect(parseQuantity('1 000,5')).toBe(1000.5);
    expect(parseQuantity('2,5555')).toBeNull();
    expect(parseQuantity('0')).toBeNull();
    expect(parseQuantity('0', { allowZero: true })).toBe(0);
  });
});
