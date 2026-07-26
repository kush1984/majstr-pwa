import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { useAddExpense, useDeleteExpense, economyKeys } from './useEconomy.ts';
import { clearOutbox, listOutbox } from '@/lib/outbox/outbox.ts';
import type { ExpenseResponse } from '@/api/types.ts';

/** A master logs a purchase standing in the shop — exactly where the signal dies. */
beforeEach(async () => { await clearOutbox(); onlineManager.setOnline(false); });
afterEach(() => onlineManager.setOnline(true));

const OBJ = 'p1';

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe('expenses — offline', () => {
  it('adds an expense optimistically and queues it against the object', async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData<ExpenseResponse[]>(economyKeys.expenses(OBJ), []);
    const { result } = renderHook(() => useAddExpense(OBJ), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ amount: 450, category: 'MATERIALS', note: 'Шпаклівка' });
    });

    const list = qc.getQueryData<ExpenseResponse[]>(economyKeys.expenses(OBJ))!;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ amount: 450, note: 'Шпаклівка', source: 'MANUAL' });
    const ops = await listOutbox();
    expect(ops[0]).toMatchObject({ entity: 'expense', type: 'create', deps: [OBJ] });
  });

  it('does NOT fake the profit summary — only the journal is patched locally', async () => {
    // Profit mixes estimate income, deposits and a completed-object settlement rule that
    // lives on the server. A locally re-derived figure could disagree with the real one, and
    // a wrong number about the master's own money is worse than a stale one.
    const { qc, wrapper } = setup();
    qc.setQueryData(economyKeys.economy(OBJ), { profit: 1000, cashBalance: 0 });
    qc.setQueryData<ExpenseResponse[]>(economyKeys.expenses(OBJ), []);
    const { result } = renderHook(() => useAddExpense(OBJ), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ amount: 700, category: 'MATERIALS' });
    });

    expect(qc.getQueryData<{ profit: number }>(economyKeys.economy(OBJ))!.profit).toBe(1000);
  });

  it('removes an expense offline', async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData<ExpenseResponse[]>(economyKeys.expenses(OBJ), [
      { id: 'e1', amount: 100, category: 'MATERIALS', source: 'MANUAL', note: null, spentAt: '2026-07-01', createdAt: '' },
      { id: 'e2', amount: 200, category: 'OTHER', source: 'MANUAL', note: null, spentAt: '2026-07-02', createdAt: '' },
    ]);
    const { result } = renderHook(() => useDeleteExpense(OBJ), { wrapper });

    await act(async () => { await result.current.mutateAsync('e1'); });

    expect(qc.getQueryData<ExpenseResponse[]>(economyKeys.expenses(OBJ))!.map((e) => e.id)).toEqual(['e2']);
    expect((await listOutbox())[0]).toMatchObject({ entity: 'expense', type: 'delete', entityId: 'e1' });
  });
});
