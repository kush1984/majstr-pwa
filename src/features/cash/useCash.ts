import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cashApi } from '@/api/cash.ts';
import { toAppError } from '@/api/errors.ts';
import { toast } from '@/hooks/useToast.ts';
import { newUuid } from '@/lib/uuid.ts';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import { dropPendingEntity, patchPendingCreate } from '@/lib/outbox/outbox.ts';
import type {
  CashEntryKind, CashEntryRequest, CashEntryResponse, CashFlowResponse, CashSummaryResponse,
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
    // Six days from where the week STARTS, carried over as a whole date. `to` is a copy of the
    // anchor, so adding `from`'s day-of-month to the anchor's own month answered about a window
    // nobody asked for whenever the week crosses a month: Wednesday 2 Sep → 31 Aug + 6 read off
    // September → 7 October. WEEK is the default tab, so that was one week in four.
    to.setFullYear(from.getFullYear(), from.getMonth(), from.getDate() + 6);
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

/** One optimistic change: the row as it was, the row as it becomes. Either half may be absent. */
export interface CashDelta {
  removed?: CashEntryResponse | null;
  added?: CashEntryResponse | null;
}

/** What one row contributes to the figures the screen adds up. */
function contribution(e: CashEntryResponse) {
  return {
    income: e.direction === 'INCOME' ? e.amount : 0,
    expense: e.direction === 'EXPENSE' ? e.amount : 0,
    refunds: e.materialRefund ? e.amount : 0,
  };
}

/**
 * Re-add the figures after an optimistic edit — by the DELTA of the row that moved, never by
 * summing what is on screen.
 *
 * <p>Summing `entries` was wrong for two windows the screen really has. The YEAR tab asks the
 * server for MONTHS and carries no entries at all, so adding one row set «Прийшло» to that row's
 * own amount; and a cut list (`truncated`) holds 500 of the rows while the totals cover them all.
 * Both showed a figure that was not stale but invented, and offline it stayed that way until the
 * next reconnect.</p>
 *
 * <p>`earned` is ONE subtraction (review B-33): the material a client pays back is already netted
 * by its own COST sitting in `expense`, because the till receipt he is owed for is a feed row of
 * its own. Subtracting `refunds` on top charged the master for it twice, so «Заробив» dropped the
 * moment a row was touched and jumped back on refetch. `refunds` survives as a LABEL — it explains
 * the gap between «Прийшло» and «Заробив» — and is never subtracted again.</p>
 */
export function applyCashDelta(flow: CashFlowResponse, change: CashDelta): CashFlowResponse {
  const out = contribution(change.removed ?? EMPTY_ROW);
  const inc = contribution(change.added ?? EMPTY_ROW);
  const income = flow.income - out.income + inc.income;
  const expense = flow.expense - out.expense + inc.expense;
  return {
    ...flow,
    income,
    expense,
    refunds: flow.refunds - out.refunds + inc.refunds,
    earned: income - expense,
  };
}

/** A row that contributes nothing — «no row on this side» written once instead of three times. */
const EMPTY_ROW: CashEntryResponse = {
  id: '', kind: 'PERSONAL', direction: 'INCOME', amount: 0,
  happenedOn: '', materialRefund: false, noteLocked: false, readOnly: false,
};

/**
 * Put a row where the server would: the feed is newest DAY first, and newest within the day.
 *
 * <p>Always prepending looked right until the date field was used. A back-dated entry opened a
 * SECOND group for a day already on screen — two React children under `key={d.day}` — and the row
 * sat at the top of a feed that is ordered by date everywhere else.</p>
 */
function insertByDay(entries: CashEntryResponse[], row: CashEntryResponse): CashEntryResponse[] {
  const at = entries.findIndex((e) => e.happenedOn <= row.happenedOn);
  const out = [...entries];
  out.splice(at === -1 ? out.length : at, 0, row);
  return out;
}

/**
 * Every write on this screen, offline-first — a master types «пальне 1200» in a van, which is most
 * of the point. ONE outbox entity covers all three kinds: adding is always his own row, and an edit
 * or a delete carries the `kind` that says which table the server should write through.
 */
export function useCashActions(period: CashPeriod) {
  const qc = useQueryClient();

  /**
   * An object's row is ONE record read through a second door, so every screen that reads the same
   * record has to be told when it moves (review P-48). A PERSONAL row belongs to nothing else, so
   * it invalidates nothing else — the object list and the dashboard are the heaviest queries the
   * app has, and refetching them because a master wrote down «пальне 400» is noise.
   */
  const invalidate = (kind: CashEntryKind = 'PERSONAL') => {
    void qc.invalidateQueries({ queryKey: ['cash'] });
    if (kind === 'PERSONAL') return;
    void qc.invalidateQueries({ queryKey: ['object-economy'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['projects'] });
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
   *
   * <p>The home strip is patched by the same delta and restored by the same undo. It used to be
   * only RESTORED: the strip kept the figures from before the edit while the screen showed the
   * ones after it, and a refused write then «put back» a summary nothing had moved. A strip and a
   * screen disagreeing about one number is the one thing a money screen may not do.</p>
   */
  const patch = (
    edit: (flow: CashFlowResponse) => CashFlowResponse,
    change: CashDelta,
  ) => {
    const key = CASH_KEY(period.from, period.to, period.monthly);
    const old = qc.getQueryData<CashFlowResponse>(key);
    const oldSummary = qc.getQueryData<CashSummaryResponse>(CASH_SUMMARY_KEY);
    if (!old) return () => undefined;
    qc.setQueryData<CashFlowResponse>(key, edit(old));
    if (oldSummary) {
      qc.setQueryData<CashSummaryResponse>(CASH_SUMMARY_KEY, summaryDelta(oldSummary, change));
    }
    return () => {
      qc.setQueryData<CashFlowResponse>(key, old);
      if (oldSummary) qc.setQueryData<CashSummaryResponse>(CASH_SUMMARY_KEY, oldSummary);
    };
  };

  const optimistically = async (
    edit: (flow: CashFlowResponse) => CashFlowResponse,
    change: CashDelta,
    write: () => Promise<void>,
  ) => {
    // A GET already in flight would land after the patch and take the row back off the screen
    // (review P-31) — the same race the shopping list had.
    await qc.cancelQueries({ queryKey: ['cash'] });
    const undo = patch(edit, change);
    try {
      await write();
    } catch (e) {
      undo();
      throw e;
    }
  };

  /** The row as it stands now — the «before» half of every delta below. */
  const current = (id: string) => qc
    .getQueryData<CashFlowResponse>(CASH_KEY(period.from, period.to, period.monthly))
    ?.entries.find((e) => e.id === id) ?? null;

  return {
    add: useMutation({
      networkMode: 'always',
      onError,
      mutationFn: (req: CashEntryRequest) => {
        const id = newUuid();
        const now = new Date();
        const row: CashEntryResponse = {
          id,
          kind: 'PERSONAL', // adding here is always his own row
          direction: req.direction,
          amount: req.amount,
          category: req.category ?? null,
          note: req.note ?? null,
          happenedOn: req.happenedOn ?? iso(now),
          happenedAt: now.toISOString(),
          projectId: null,
          projectName: null,
          materialRefund: req.materialRefund,
          noteLocked: false,
          readOnly: false, // his own `cash_entry`: nothing has frozen it into an act
        };
        return optimistically(
          (flow) => applyCashDelta(
            { ...flow, entries: insertByDay(flow.entries, row) },
            { added: row },
          ),
          { added: row },
          () => offlineMutate<void>({
            entity: 'cashEntry', entityId: id, type: 'create', payload: { req },
            online: async () => { await cashApi.add(req, id); },
            onOnlineSuccess: () => invalidate(),
            optimistic: () => undefined, // the cache is patched above, on BOTH paths
          }),
        );
      },
    }),
    update: useMutation({
      networkMode: 'always',
      onError,
      mutationFn: async (vars: { id: string; req: CashEntryRequest }) => {
        const before = current(vars.id);
        const after: CashEntryResponse | null = before
          ? {
              ...before,
              direction: vars.req.direction,
              amount: vars.req.amount,
              category: vars.req.category ?? null,
              note: vars.req.note ?? null,
              happenedOn: vars.req.happenedOn ?? before.happenedOn,
              materialRefund: vars.req.materialRefund,
            }
          : null;
        // Correcting a row whose own create is still queued is not a second fact about it — it is
        // what the row always was, as far as the server will ever know. Rewritten in place, so a
        // PATCH can never replay against a row the server has not been told about yet. False means
        // the queue drained (or that POST is already in the air), and the ordinary write is right.
        const folded = await patchPendingCreate('cashEntry', vars.id, (payload) => ({
          ...(payload as { req: CashEntryRequest }), req: vars.req,
        }));
        return optimistically(
          (flow) => applyCashDelta(
            { ...flow, entries: flow.entries.map((e) => (e.id === vars.id && after ? after : e)) },
            { removed: before, added: after },
          ),
          { removed: before, added: after },
          () => (folded
            ? Promise.resolve()
            : offlineMutate<void>({
                entity: 'cashEntry', entityId: vars.id, type: 'update', payload: { req: vars.req },
                online: async () => { await cashApi.update(vars.id, vars.req); },
                onOnlineSuccess: () => invalidate(vars.req.kind ?? 'PERSONAL'),
                optimistic: () => undefined,
              })),
        );
      },
    }),
    /** Any row, his own or an object's — the payload carries WHICH, because a DELETE has no body. */
    remove: useMutation({
      networkMode: 'always',
      onError,
      mutationFn: async (vars: { id: string; kind: CashEntryKind }) => {
        const before = current(vars.id);
        // Everything queued about a row that never reached the server goes with it (review P-18):
        // dropping only the create left an edit queued behind it, replaying as a PATCH on nothing.
        const dropped = await dropPendingEntity('cashEntry', vars.id);
        return optimistically(
          (flow) => applyCashDelta(
            { ...flow, entries: flow.entries.filter((e) => e.id !== vars.id) },
            { removed: before },
          ),
          { removed: before },
          () => (dropped
            ? Promise.resolve()
            : offlineMutate<void>({
                entity: 'cashEntry', entityId: vars.id, type: 'delete', payload: { kind: vars.kind },
                online: async () => { await cashApi.remove(vars.id, vars.kind); },
                onOnlineSuccess: () => invalidate(vars.kind),
                optimistic: () => undefined,
              })),
        );
      },
    }),
  };
}

/**
 * The home strip's own figures, moved by the same delta — but only for a row inside the window the
 * strip is showing. The strip is the MONTH while the screen opens on the WEEK, so a back-dated
 * entry can legitimately belong to one and not to the other.
 */
function summaryDelta(summary: CashSummaryResponse, change: CashDelta): CashSummaryResponse {
  const inside = (e?: CashEntryResponse | null) =>
    (e && e.happenedOn >= summary.from && e.happenedOn <= summary.to ? e : null);
  const out = contribution(inside(change.removed) ?? EMPTY_ROW);
  const inc = contribution(inside(change.added) ?? EMPTY_ROW);
  const income = summary.income - out.income + inc.income;
  const expense = summary.expense - out.expense + inc.expense;
  return {
    ...summary,
    income,
    expense,
    earned: income - expense,
    hasEntries: summary.hasEntries || inc.income > 0 || inc.expense > 0,
  };
}
