import { describe, it, expect } from 'vitest';
import { applyCashDelta, cashPeriod, monthPeriod } from './useCash.ts';
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

  it('ends a week six days after it STARTED, across a month boundary', () => {
    // Review P-19. `to` was a copy of the ANCHOR, so «31 August + 6» was counted in the anchor's
    // own month: Wednesday 2 September asked the server for 31 Aug – 7 OCTOBER. WEEK is the
    // default tab, so roughly one week a month the screen opened on five weeks of money.
    const wednesday = cashPeriod('WEEK', new Date(2026, 8, 2)); // Wed 2 Sep 2026
    expect(wednesday.from).toBe('2026-08-31');
    expect(wednesday.to).toBe('2026-09-06');

    // Sunday 1 March 2026 belongs to the week that began in February.
    const sunday = cashPeriod('WEEK', new Date(2026, 2, 1));
    expect(sunday.from).toBe('2026-02-23');
    expect(sunday.to).toBe('2026-03-01');

    // And across a year.
    const newYear = cashPeriod('WEEK', new Date(2026, 11, 31)); // Thu 31 Dec 2026
    expect(newYear.from).toBe('2026-12-28');
    expect(newYear.to).toBe('2027-01-03');
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
describe('applyCashDelta', () => {
  const totals = (over: Partial<CashFlowResponse>) => ({ ...flow([]), ...over });

  it('earns income minus outlays — ONE subtraction, whatever came back for material', () => {
    // Review B-33. The material the client repays is netted by its own COST already being a feed
    // row, so subtracting the refund again billed the master for the same purchase twice.
    const after = applyCashDelta(
      totals({ income: 28000, expense: 8000, refunds: 0, earned: 20000 }),
      { added: entry({ id: 'r1', amount: 8000, materialRefund: true }) },
    );

    expect(after.income).toBe(36000);
    expect(after.expense).toBe(8000);
    expect(after.refunds).toBe(8000);
    expect(after.earned).toBe(28000); // and NOT 20 000
  });

  it('moves the figures by the DELTA, never by summing what is on screen', () => {
    // Review P-21. The YEAR view answers MONTHS and carries no entries at all, and a truncated
    // list holds 500 of the rows while the totals cover them all — summing `entries` there turned
    // a month of money into the one row that had just been added.
    const year = totals({ income: 240000, expense: 90000, earned: 150000, entries: [] });

    const after = applyCashDelta(year, { added: entry({ id: 'x', amount: 1000 }) });

    expect(after.income).toBe(241000);
    expect(after.expense).toBe(90000);
    expect(after.earned).toBe(151000);
  });

  it('swaps one row for another — an edit is a removal and an addition', () => {
    const before = entry({ id: 'e1', direction: 'EXPENSE', amount: 1200 });
    const after = applyCashDelta(
      totals({ income: 5000, expense: 1200, earned: 3800 }),
      { removed: before, added: { ...before, amount: 400 } },
    );

    expect(after.expense).toBe(400);
    expect(after.earned).toBe(4600);
  });

  it('drops a refund out of the label when its row is deleted', () => {
    const refund = entry({ id: 'r1', amount: 5000, materialRefund: true });
    const after = applyCashDelta(
      totals({ income: 5000, expense: 0, refunds: 5000, earned: 5000 }),
      { removed: refund },
    );

    expect(after.refunds).toBe(0);
    expect(after.income).toBe(0);
  });
});
