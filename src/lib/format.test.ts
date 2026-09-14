import { describe, it, expect } from 'vitest';
import { formatDate } from './format.ts';

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
