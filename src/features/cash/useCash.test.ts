import { describe, it, expect } from 'vitest';
import { cashPeriod, monthPeriod, cashTotals } from './useCash.ts';
import type { CashEntryResponse, CashFlowResponse } from '@/api/types.ts';

/**
 * The period IS the feature: every number on the screen is meaningless without «за коли».
 *
 * <p>It is computed on the master's own phone on purpose — the device already sits in his
 * timezone, so «цей тиждень» needs no agreement with the server about what today is. What the
 * server still owns is the default for a request with no bounds, and that one resolves in
 * `Europe/Kyiv` (the UTC-boundary open question).</p>
 */
describe('cashPeriod', () => {
  it('starts a week on MONDAY, not on Sunday', () => {
    // `getDay()` calls Sunday 0, so the naive version puts a Sunday's earnings in the week that is
    // about to begin — the one day of seven a master is most likely to be adding them up.
    const sunday = new Date(2026, 8, 13); // Sun 13 Sep 2026
    const period = cashPeriod('WEEK', sunday);

    expect(period.from).toBe('2026-09-07'); // Monday
    expect(period.to).toBe('2026-09-13');
  });

  it('keeps a Monday in its own week', () => {
    const period = cashPeriod('WEEK', new Date(2026, 8, 7));

    expect(period.from).toBe('2026-09-07');
    expect(period.to).toBe('2026-09-13');
  });

  it('ends a month on its real last day, whatever the month is', () => {
    expect(cashPeriod('MONTH', new Date(2026, 8, 10)).to).toBe('2026-09-30');
    expect(cashPeriod('MONTH', new Date(2026, 1, 10)).to).toBe('2026-02-28');
    expect(cashPeriod('MONTH', new Date(2024, 1, 10)).to).toBe('2024-02-29'); // leap year
  });

  it('asks for MONTHS on the year view, never a flat list', () => {
    const year = cashPeriod('YEAR', new Date(2026, 8, 10));

    expect(year.from).toBe('2026-01-01');
    expect(year.to).toBe('2026-12-31');
    // Two thousand rows is not a screen anyone reads on a phone.
    expect(year.monthly).toBe(true);
    expect(cashPeriod('MONTH').monthly).toBe(false);
  });

  it('drills from a year row straight into that month', () => {
    const period = monthPeriod('2026-02-01');

    expect(period.kind).toBe('MONTH');
    expect(period.from).toBe('2026-02-01');
    expect(period.to).toBe('2026-02-28');
  });
});

function entry(over: Partial<CashEntryResponse> = {}): CashEntryResponse {
  return {
    id: 'e1', kind: 'PERSONAL', direction: 'INCOME', amount: 1000, category: null, note: null,
    happenedOn: '2026-09-10', happenedAt: '2026-09-10T08:00:00Z', projectId: null,
    projectName: null, materialRefund: false, noteLocked: false, readOnly: false, ...over,
  };
}

function flow(entries: CashEntryResponse[]): CashFlowResponse {
  return {
    from: '2026-09-01', to: '2026-09-30', income: 0, expense: 0, earned: 0, refunds: 0,
    entries, months: [], truncated: false,
  };
}

/**
 * The optimistic side of «Мої гроші» must do the SERVER's arithmetic, or an edit moves a figure
 * the refetch then moves back — on a money screen that reads as the app being wrong.
 */
describe('cashTotals', () => {
  it('earns income minus outlays — ONE subtraction, whatever came back for material', () => {
    // Review B-33. The material the client repays is netted by its own COST already being a feed
    // row, so subtracting the refund again billed the master for the same purchase twice.
    const totals = cashTotals(flow([
      entry({ id: 'i1', amount: 28000 }),
      entry({ id: 'r1', amount: 8000, materialRefund: true }),
      entry({ id: 'e1', direction: 'EXPENSE', amount: 8000 }),
    ]));

    expect(totals.income).toBe(36000);
    expect(totals.expense).toBe(8000);
    expect(totals.earned).toBe(28000);
  });

  it('keeps `refunds` as a LABEL — it explains the gap, it never moves it', () => {
    const totals = cashTotals(flow([
      entry({ id: 'r1', amount: 5000, materialRefund: true }),
      entry({ id: 'e1', direction: 'EXPENSE', amount: 5000 }),
    ]));

    expect(totals.refunds).toBe(5000);
    expect(totals.earned).toBe(0); // and NOT −5 000
  });
});
