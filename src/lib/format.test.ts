import { describe, it, expect } from 'vitest';
import { formatAmount, formatDate, formatMoney, formatMoneyExact } from './format.ts';

/**
 * The year is computed rather than hardcoded so these stay true next January, and both fixtures sit
 * mid-year so a run that straddles New Year cannot flip which side of the rule they fall on.
 */
const YEAR = new Date().getFullYear();
const thisYear = `${YEAR}-06-15`;
const lastYear = `${YEAR - 1}-06-15`;

/*
 * The day number is deliberately not asserted: `new Date('YYYY-06-15')` is UTC midnight, so a
 * machine west of UTC renders the 14th. Month and year are what this rule is about.
 */
describe('formatDate', () => {
  it('leaves the year off a date in the current year', () => {
    const out = formatDate(thisYear);
    expect(out).toContain('червня');
    expect(out).not.toContain(String(YEAR));
  });

  it('prints the year once the date is no longer in the current year', () => {
    // «Підписано 15 червня» on an estimate signed last June reads as three months ago.
    const out = formatDate(lastYear);
    expect(out).toContain('червня');
    expect(out).toContain(String(YEAR - 1));
  });

  it('prints the year on an old date too', () => {
    expect(formatDate('2019-06-15')).toContain('2019');
  });

  it('still answers empty for nothing and for a date it cannot read', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('')).toBe('');
    expect(formatDate('не дата')).toBe('');
  });
});

/**
 * ONE rule for money on screen: kopecks when there ARE kopecks (reviews P-43, P-46).
 *
 * <p>It used to round to whole hryvnia everywhere, which lied in two directions at once. A unit
 * price of 0,40 ₴ read «0 ₴/шт» and 12,50 read «13 ₴/м²» beside a «125 ₴» that was exact; an
 * estimate total showed «12 346 ₴» where the PDF the client signs says 12 345,50; and the economy
 * panel's rounded parts did not add up to its rounded sum.</p>
 *
 * <p>Nothing pinned that rule until now — `format.test.ts` covered only `formatDate`, so the whole
 * change could have been reverted by a tidy-up with every test still green. The thin space uk-UA
 * groups with is matched loosely on purpose: the grouping character is the platform ICU's business,
 * the number of decimals is ours.</p>
 */
describe('formatMoney', () => {
  // \s already covers every separator uk-UA might group with - NBSP and NARROW NBSP
  // are both in ECMAScript WhiteSpace - so which one the ICU picked is not this test's business.
  const digits = (s: string) => s.replace(/\s/g, '');

  it('hides kopecks that are not there', () => {
    expect(digits(formatMoney(61070))).toBe('61070₴');
    expect(digits(formatMoney(0))).toBe('0₴');
  });

  it('shows kopecks that ARE there — the figure the client signs for', () => {
    expect(digits(formatMoney(12345.5))).toBe('12345,50₴');
    expect(digits(formatMoney(0.4))).toBe('0,40₴'); // read «0 ₴/шт» before
    expect(digits(formatMoney(12.5))).toBe('12,50₴'); // read «13 ₴/м²» before
  });

  it('is not fooled into decimals by float noise', () => {
    // 0.1 + 0.2 is 0.30000000000000004, and a sum of kopeck lines lands like that constantly.
    expect(digits(formatMoney(0.1 + 0.2))).toBe('0,30₴');
    expect(digits(formatMoney(61070.0000000001))).toBe('61070₴');
  });

  it('answers for nothing, and keeps a negative negative', () => {
    expect(digits(formatMoney(null))).toBe('0₴');
    expect(digits(formatMoney(undefined))).toBe('0₴');
    expect(digits(formatMoney(-617.28))).toContain('617,28'); // a «−%» line
  });

  it('applies the same rule without the glyph, for a row under a currency header', () => {
    expect(digits(formatAmount(61070))).toBe('61070');
    expect(digits(formatAmount(12345.5))).toBe('12345,50');
  });

  it('leaves `formatMoneyExact` always exact — the places that must show two decimals', () => {
    expect(digits(formatMoneyExact(61070))).toBe('61070,00₴');
  });
});
