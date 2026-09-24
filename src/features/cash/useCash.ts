import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cashApi } from '@/api/cash.ts';
import { toAppError } from '@/api/errors.ts';
import { toast } from '@/hooks/useToast.ts';
import { newUuid } from '@/lib/uuid.ts';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import type {
  CashEntryKind, CashEntryRequest, CashFlowResponse, CashSummaryResponse,
} from '@/api/types.ts';

/** Which window of time the screen is showing. */
export type CashPeriodKind = 'WEEK' | 'MONTH' | 'YEAR' | 'CUSTOM';

export interface CashPeriod {
  kind: CashPeriodKind;
  from: string;
  to: string;
  /** The YEAR view asks for per-month totals instead of a flat list. */
  monthly: boolean;
}

/** Exported so the offline prefetch primes the SAME key the screen reads. */
export const CASH_KEY = (from: string, to: string, monthly: boolean) =>
  ['cash', from, to, monthly] as const;
export const CASH_SUMMARY_KEY = ['cash', 'summary'] as const;

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The period the master means, computed on HIS phone.
 *
 * <p>Deliberately client-side: the device already sits in his timezone, so «цей тиждень» needs no
 * agreement with the server about what today is. The server only needs a default for a request that
 * carries no bounds, and that one resolves in `Europe/Kyiv` — on the 1st at 01:00 a UTC boundary
 * would open «цей місяць» on the previous one.</p>
 *
 * <p>A WEEK starts on MONDAY. `getDay()` calls Sunday 0, which would otherwise put a Sunday's
 * earnings in the week that is about to begin.</p>
 */
export function cashPeriod(kind: CashPeriodKind, anchor: Date = new Date()): CashPeriod {
  const from = new Date(anchor);
  const to = new Date(anchor);
  if (kind === 'WEEK') {
    const weekday = (anchor.getDay() + 6) % 7; // Monday = 0
    from.setDate(anchor.getDate() - weekday);
    to.setDate(from.getDate() + 6);
  } else if (kind === 'MONTH') {
    from.setDate(1);
    to.setMonth(anchor.getMonth() + 1, 0); // day 0 of next month = last of this one
  } else {
    from.setMonth(0, 1);
    to.setMonth(11, 31);
  }
  return { kind, from: iso(from), to: iso(to), monthly: kind === 'YEAR' };
}

/**
 * Two dates the master picked himself — «за який період» when none of the three buttons is it:
 * a job that ran from the 12th to the 3rd, a quarter, last year's September.
 *
 * <p>A flat list, never the YEAR view's month totals: he chose the window, so he wants what is
 * inside it. Reversed bounds are not an error worth a message — the server swaps them anyway, and
 * so does this, because two date fields on a phone are tapped in whatever order.</p>
 */
export function customPeriod(from: string, to: string): CashPeriod {
  const [start, end] = from <= to ? [from, to] : [to, from];
  return { kind: 'CUSTOM', from: start, to: end, monthly: false };
}

/** One month by its first day — what a YEAR row drills into. */
export function monthPeriod(firstDay: string): CashPeriod {
  const [y, m] = firstDay.split('-').map(Number);
  return cashPeriod('MONTH', new Date(y, m - 1, 1));
}

export function useCashFlow(period: CashPeriod) {
  return useQuery({
    queryKey: CASH_KEY(period.from, period.to, period.monthly),
    queryFn: () => cashApi.flow({ from: period.from, to: period.to, monthly: period.monthly }),
  });
}

/**
 * The home strip. It renders nothing when nothing moved this month — same rule as the shopping
 * card, which disappears when there is nothing left to buy. The dashboard is already long.
 */
export function useCashSummary() {
  return useQuery({
    queryKey: CASH_SUMMARY_KEY,
    queryFn: () => cashApi.summary(),
  });
}

/**
 * Every write on this screen, offline-first — a master types «пальне 1200» in a van, which is most
 * of the point. ONE outbox entity covers all three kinds: adding is always his own row, and an edit
 * or a delete carries the `kind` that says which table the server should write through.
 */
export function useCashActions(period: CashPeriod) {
  const qc = useQueryClient();

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['cash'] });
  };

  /** Say so when a write is refused — silence here means a master walks away thinking it saved. */
  const onError = (err: unknown) => {
    toast.error(toAppError(err).message);
  };

  /**
   * Move the screen first, put it back if the server refuses.
   *
   * <p>The refetch behind it is what makes the row real — an edit of an OBJECT row is written by
   * that object's own service, which may refuse it (an expense a till receipt owns), and the undo
   * is what keeps the screen honest when it does.</p>
   */
  const patch = (edit: (flow: CashFlowResponse) => CashFlowResponse) => {
    const key = CASH_KEY(period.from, period.to, period.monthly);
    const old = qc.getQueryData<CashFlowResponse>(key);
    const oldSummary = qc.getQueryData<CashSummaryResponse>(CASH_SUMMARY_KEY);
    if (!old) return () => undefined;
    qc.setQueryData<CashFlowResponse>(key, edit(old));
    return () => {
      qc.setQueryData<CashFlowResponse>(key, old);
      if (oldSummary) qc.setQueryData<CashSummaryResponse>(CASH_SUMMARY_KEY, oldSummary);
    };
  };

  const totals = (flow: CashFlowResponse): CashFlowResponse => {
    const income = flow.entries.filter((e) => e.direction === 'INCOME')
      .reduce((s, e) => s + e.amount, 0);
    const expense = flow.entries.filter((e) => e.direction === 'EXPENSE')
      .reduce((s, e) => s + e.amount, 0);
    const refunds = flow.entries.filter((e) => e.materialRefund).reduce((s, e) => s + e.amount, 0);
    return { ...flow, income, expense, refunds, earned: income - refunds - expense };
  };

  const optimistically = async (
    edit: (flow: CashFlowResponse) => CashFlowResponse,
    write: () => Promise<void>,
  ) => {
    const undo = patch(edit);
    try {
      await write();
    } catch (e) {
      undo();
      throw e;
    }
  };

  return {
    add: useMutation({
      networkMode: 'always',
      onError,
      mutationFn: (req: CashEntryRequest) => {
        const id = newUuid();
        const today = new Date();
        return optimistically(
          (flow) => totals({
            ...flow,
            entries: [
              {
                id,
                kind: 'PERSONAL', // adding here is always his own row
                direction: req.direction,
                amount: req.amount,
                category: req.category ?? null,
                note: req.note ?? null,
                happenedOn: req.happenedOn ?? iso(today),
                happenedAt: today.toISOString(),
                projectId: null,
                projectName: null,
                materialRefund: req.materialRefund,
                noteLocked: false,
              },
              ...flow.entries,
            ],
          }),
          () => offlineMutate<void>({
            entity: 'cashEntry', entityId: id, type: 'create', payload: { req },
            online: async () => { await cashApi.add(req, id); },
            onOnlineSuccess: invalidate,
            optimistic: () => undefined, // the cache is patched above, on BOTH paths
          }),
        );
      },
    }),
    update: useMutation({
      networkMode: 'always',
      onError,
      mutationFn: (vars: { id: string; req: CashEntryRequest }) =>
        optimistically(
          (flow) => totals({
            ...flow,
            entries: flow.entries.map((e) => (e.id === vars.id
              ? {
                  ...e,
                  direction: vars.req.direction,
                  amount: vars.req.amount,
                  category: vars.req.category ?? null,
                  note: vars.req.note ?? null,
                  happenedOn: vars.req.happenedOn ?? e.happenedOn,
                  materialRefund: vars.req.materialRefund,
                }
              : e)),
          }),
          () => offlineMutate<void>({
            entity: 'cashEntry', entityId: vars.id, type: 'update', payload: { req: vars.req },
            online: async () => { await cashApi.update(vars.id, vars.req); },
            onOnlineSuccess: invalidate,
            optimistic: () => undefined,
          }),
        ),
    }),
    /** Any row, his own or an object's — the payload carries WHICH, because a DELETE has no body. */
    remove: useMutation({
      networkMode: 'always',
      onError,
      mutationFn: (vars: { id: string; kind: CashEntryKind }) =>
        optimistically(
          (flow) => totals({ ...flow, entries: flow.entries.filter((e) => e.id !== vars.id) }),
          () => offlineMutate<void>({
            entity: 'cashEntry', entityId: vars.id, type: 'delete', payload: { kind: vars.kind },
            online: async () => { await cashApi.remove(vars.id, vars.kind); },
            onOnlineSuccess: invalidate,
            optimistic: () => undefined,
          }),
        ),
    }),
  };
}
