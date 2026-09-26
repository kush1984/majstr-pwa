import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { ErrorState } from '@/components/ErrorState.tsx';
import { routes } from '@/lib/config.ts';
import { formatMoneyExact, formatDate } from '@/lib/format.ts';
import type { CashEntryResponse, CashMonthTotal } from '@/api/types.ts';
import { AddCashSheet } from './AddCashSheet.tsx';
import {
  cashPeriod, customPeriod, monthPeriod, useCashActions, useCashFlow,
  type CashPeriod, type CashPeriodKind,
} from './useCash.ts';

const TABS: CashPeriodKind[] = ['WEEK', 'MONTH', 'YEAR', 'CUSTOM'];

/**
 * «Мої гроші» — the master's own cash movement, across every object and beside them.
 *
 * <p>What it shows is a UNION, not a second book: client payments and spending from all his
 * objects, plus the rows no object knows about (fuel, tools, taxes, income for work that closed
 * without an act). A standalone personal ledger was rejected — he already logs object money, and a
 * book that ignored it would either be wrong or make him type everything twice.</p>
 *
 * <p>Three numbers, because «Прийшло» and «Заробив» are not the same question: material the client
 * merely paid back arrived, but it is not earnings.</p>
 *
 * <p>The YEAR tab lists MONTHS, not rows — two thousand lines is not a screen anyone reads on a
 * phone — and tapping one drills into it.</p>
 */
export function CashFlowPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  // The WEEK by default (master's call): «за цей тиждень» is the question he actually opens this
  // screen with. The home strip is the one exception — it shows the MONTH, so it says so in the
  // navigation state and the screen lands on exactly the window he tapped.
  const [period, setPeriod] = useState<CashPeriod>(
    () => cashPeriod((location.state as { period?: CashPeriodKind } | null)?.period ?? 'WEEK'),
  );
  // The custom range lives beside the period, not inside it: the two fields stay filled while he
  // switches to «Місяць» and back, so a second look at the same window is one tap, not four.
  const [range, setRange] = useState<{ from: string; to: string }>(
    () => ({ from: period.from, to: period.to }),
  );
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CashEntryResponse | null>(null);

  const flow = useCashFlow(period);
  const actions = useCashActions(period);

  /**
   * «←» goes back to the door he came IN by — the home strip or the Профіль row — not always to one
   * of them. Same `state.from` the shopping list uses.
   *
   * <p>Профіль is the fallback, for a reload or a shared link that carries no state: «Мої гроші» is
   * his own section, and that is where he goes looking for it.</p>
   */
  const back = (location.state as { from?: string } | null)?.from ?? routes.profile;

  /** Rows grouped by day, newest first — the server already sorted, so this only cuts the runs. */
  const days = useMemo(() => {
    const out: { day: string; rows: CashEntryResponse[] }[] = [];
    for (const e of flow.data?.entries ?? []) {
      const last = out[out.length - 1];
      if (last && last.day === e.happenedOn) last.rows.push(e);
      else out.push({ day: e.happenedOn, rows: [e] });
    }
    return out;
  }, [flow.data]);

  const failed = flow.isError && !flow.data;

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto max-w-xl px-4 pb-28 pt-4 sm:px-6">
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(back)}
            aria-label={t('common.back')}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-lg text-primary"
          >
            ←
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold tracking-tight text-primary">
              {t('cash.title')}
            </h1>
            {/* Three words that answer the question the master asked out loud — «я думав що воно
                зразу буде тягнути кошти по всіх обʼєктах». It does, and nothing on the screen said
                so, which is why the object picker in the add form read as «pick one or nothing
                happens». */}
            <p className="truncate text-xs text-muted">{t('cash.subtitle')}</p>
          </div>
        </div>

        {/* Period first: every number below it means nothing without saying «за коли». */}
        <div className="mb-4 flex gap-2">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setPeriod(tab === 'CUSTOM' ? customPeriod(range.from, range.to) : cashPeriod(tab))}
              aria-pressed={period.kind === tab}
              className={
                'min-h-11 flex-1 rounded-xl px-3 text-sm font-semibold ' +
                (period.kind === tab
                  ? 'bg-brand text-white'
                  : 'bg-surface-sunken text-secondary')
              }
            >
              {t('cash.period' + tab)}
            </button>
          ))}
        </div>

        {/* Only while «Період» is the answer — two empty fields above every other view would be
            four taps of furniture on a screen opened to read three numbers. */}
        {period.kind === 'CUSTOM' && (
          <div className="mb-4 flex items-end gap-2">
            <label className="flex-1">
              <span className="mb-1 block text-xs text-muted">{t('cash.rangeFrom')}</span>
              <input
                type="date"
                value={range.from}
                max={range.to}
                onChange={(e) => {
                  const next = { ...range, from: e.target.value };
                  setRange(next);
                  if (next.from) setPeriod(customPeriod(next.from, next.to));
                }}
                className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-primary"
              />
            </label>
            <label className="flex-1">
              <span className="mb-1 block text-xs text-muted">{t('cash.rangeTo')}</span>
              <input
                type="date"
                value={range.to}
                min={range.from}
                onChange={(e) => {
                  const next = { ...range, to: e.target.value };
                  setRange(next);
                  if (next.to) setPeriod(customPeriod(next.from, next.to));
                }}
                className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-primary"
              />
            </label>
          </div>
        )}

        {flow.isLoading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : failed ? (
          <ErrorState error={flow.error} what={t('cash.title')} onRetry={() => void flow.refetch()} />
        ) : (
          <>
            <Totals flow={flow.data!} />

            {flow.data!.truncated && (
              <p className="mb-3 rounded-xl border border-border bg-surface px-3 py-2 text-xs text-muted">
                {t('cash.truncated', { count: flow.data!.entries.length })}
              </p>
            )}

            {period.monthly ? (
              <MonthList months={flow.data!.months} onOpen={(m) => setPeriod(monthPeriod(m))} />
            ) : days.length === 0 ? (
              <EmptyState icon="💰" title={t('cash.emptyTitle')} text={t('cash.emptyText')} />
            ) : (
              <div className="space-y-4">
                {days.map((d) => (
                  <div key={d.day}>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                      {formatDate(d.day)}
                    </p>
                    {/* EVERY row opens for editing, an object's own included (master's ruling).
                        It is a second door to one record, never a second copy — the write goes
                        through that object's own endpoints, so its rules still hold. */}
                    <div className="overflow-hidden rounded-card border border-border bg-surface">
                      {d.rows.map((e) => (
                        <Row key={e.id} entry={e} onOpen={() => setEditing(e)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Full-width and in the thumb zone: this is the action the screen exists for. */}
      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-surface px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3">
        <div className="mx-auto max-w-xl">
          <Button fullWidth onClick={() => setAdding(true)}>+ {t('cash.add')}</Button>
        </div>
      </div>

      <AddCashSheet
        open={adding}
        onClose={() => setAdding(false)}
        onSubmit={(req) => {
          actions.add.mutate(req);
          setAdding(false);
        }}
      />
      <AddCashSheet
        open={editing != null}
        entry={editing}
        onClose={() => setEditing(null)}
        onSubmit={(req) => {
          if (editing) actions.update.mutate({ id: editing.id, req });
          setEditing(null);
        }}
        onDelete={() => {
          if (editing) actions.remove.mutate({ id: editing.id, kind: editing.kind });
          setEditing(null);
        }}
      />
    </div>
  );
}

/** «Прийшло» / «Витрачено» / «Заробив» — and the gap between the first and the last, explained. */
function Totals({ flow }: { flow: { income: number; expense: number; earned: number; refunds: number } }) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 rounded-card border border-border bg-surface p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted">{t('cash.income')}</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-success">
          +{formatMoneyExact(flow.income)}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted">{t('cash.expense')}</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-primary">
          −{formatMoneyExact(flow.expense)}
        </span>
      </div>
      <div className="mt-2.5 flex items-baseline justify-between gap-2 border-t border-border pt-2.5">
        <span className="text-sm font-bold text-primary">{t('cash.earned')}</span>
        <span className="font-mono text-base font-extrabold tabular-nums text-primary">
          {formatMoneyExact(flow.earned)}
        </span>
      </div>
      {/* Without this the gap between «Прийшло» and «Заробив» looks like our arithmetic slipping. */}
      {flow.refunds > 0 && (
        <p className="mt-1.5 text-xs text-muted">
          {t('cash.refundsHint', { amount: formatMoneyExact(flow.refunds) })}
        </p>
      )}
    </div>
  );
}

function MonthList({ months, onOpen }: { months: CashMonthTotal[]; onOpen: (month: string) => void }) {
  const { t } = useTranslation();
  if (months.length === 0) {
    return <EmptyState icon="💰" title={t('cash.emptyTitle')} text={t('cash.emptyText')} />;
  }
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      {months.map((m) => (
        <button
          key={m.month}
          type="button"
          onClick={() => onOpen(m.month)}
          className="flex min-h-14 w-full items-center gap-3 border-b border-border px-3.5 text-left last:border-b-0"
        >
          <span className="text-sm font-medium text-primary">
            {new Date(m.month).toLocaleDateString('uk-UA', { month: 'long' })}
          </span>
          <span className="ml-auto flex flex-shrink-0 items-baseline gap-2 font-mono text-sm tabular-nums">
            <span className="text-success">+{formatMoneyExact(m.income)}</span>
            <span className="text-muted">−{formatMoneyExact(m.expense)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** One line: what it was, where it came from, how much. 56 px because it is tapped with a thumb. */
function Row({ entry, onOpen }: { entry: CashEntryResponse; onOpen: () => void }) {
  const { t } = useTranslation();
  const income = entry.direction === 'INCOME';
  const label = entry.note?.trim()
    || (entry.category ? t('cashCategory.' + entry.category) : t(income ? 'cash.income' : 'cash.expense'));
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-primary">{label}</span>
        <span className="block truncate text-xs text-muted">
          {entry.projectName ?? t('cash.noObject')}
          {entry.materialRefund && ` · ${t('cash.refundBadge')}`}
          {entry.readOnly && ` · ${t('cash.lockedBadge')}`}
        </span>
      </span>
      <span
        className={
          'flex-shrink-0 font-mono text-sm font-semibold tabular-nums '
          + (income ? 'text-success' : 'text-primary')
        }
      >
        {income ? '+' : '−'}{formatMoneyExact(entry.amount)}
      </span>
    </>
  );
  const className =
    'flex min-h-14 w-full items-center gap-3 border-b border-border px-3.5 py-2 text-left last:border-b-0';
  // A receipt frozen inside a signed act's `doc_hash` cannot be retyped from here — the server
  // answers 409 and it is right to. So the row is still SHOWN (the money left his pocket and the
  // month must add up) but carries no tap at all: an affordance that can only fail reads as the
  // app being broken, which is how the master described the ones we used to offer.
  if (entry.readOnly) {
    return <div className={className}>{body}</div>;
  }
  return (
    <button type="button" onClick={onOpen} className={className}>
      {body}
    </button>
  );
}
