import { describe, it, expect } from 'vitest';
import { applyMoneyDelta } from './useObjectMoney.ts';
import type { CashEntryResponse, ObjectMoneyResponse } from '@/api/types.ts';

function money(over: Partial<ObjectMoneyResponse> = {}): ObjectMoneyResponse {
  return {
    income: 10000, expense: 2000, earned: 8000,
    materials: { projectId: 'p1', bought: 0, given: 0, outstanding: 0 },
    crewRecorded: false, entries: [], truncated: false, ...over,
  };
}

function row(over: Partial<CashEntryResponse> = {}): CashEntryResponse {
  return {
    id: 'r1', kind: 'OBJECT_EXPENSE', direction: 'EXPENSE', amount: 3000, category: 'CREW',
    note: null, happenedOn: '2026-11-02', projectId: 'p1', materialRefund: false,
    clientMaterial: false, noteLocked: false, readOnly: false, hasPhoto: false, ...over,
  };
}

/** The offline card moves by the row that moved — the server's own rule, never a re-sum. */
describe('applyMoneyDelta', () => {
  it('a crew payment lowers «Заробив» and silences the crew warning', () => {
    const after = applyMoneyDelta(money(), { added: row() });

    expect(after.expense).toBe(5000);
    expect(after.earned).toBe(5000);
    expect(after.crewRecorded).toBe(true);
    expect(after.entries).toHaveLength(1);
  });

  it('money «на матеріал» moves only the material line', () => {
    const after = applyMoneyDelta(money(), {
      added: row({ id: 'm1', kind: 'OBJECT_PAYMENT', direction: 'INCOME', amount: 10000,
        category: null, materialRefund: true, clientMaterial: true }),
    });

    expect(after.income).toBe(10000);
    expect(after.earned).toBe(8000);
    expect(after.materials.given).toBe(10000);
    expect(after.materials.outstanding).toBe(-10000);
  });

  it('the part of the client money that paid a signed act stays off the balance', () => {
    // 5 000 given, 763,72 at the till, 4 236,28 went to the act — the server's figures.
    const settled = money({ materials: { projectId: 'p1', bought: 763.72, given: 5000, toActs: 4236.28, outstanding: 0 } });

    // A crew payment is not material money: the balance stays closed.
    expect(applyMoneyDelta(settled, { added: row() }).materials.outstanding).toBe(0);
    // A smaller advance leaves less for the act: never more than what is left after the till.
    const less = row({ id: 'm1', kind: 'OBJECT_PAYMENT', direction: 'INCOME', amount: 5000, category: null,
      materialRefund: true, clientMaterial: true });
    const after = applyMoneyDelta(settled, { removed: less, added: { ...less, amount: 3000 } }).materials;
    expect(after.toActs).toBe(2236.28);
    expect(after.outstanding).toBe(0);
  });

  it('an edit is a removal and an addition', () => {
    const before = row({ amount: 3000 });
    const after = applyMoneyDelta(money({ expense: 5000, earned: 5000, entries: [before] }), {
      removed: before, added: { ...before, amount: 3500 },
    });

    expect(after.expense).toBe(5500);
    expect(after.entries).toHaveLength(1);
  });
});
