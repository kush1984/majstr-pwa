import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { Modal } from '@/components/Modal.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { ErrorState } from '@/components/ErrorState.tsx';
import { routes } from '@/lib/config.ts';
import { formatMoney, formatDate } from '@/lib/format.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { cashApi, type CashObjectFilter } from '@/api/cash.ts';
import { useProjects } from '@/features/projects/useProjects.ts';
import type { CashEntryResponse, CashMaterialBalance, CashMonthTotal, CashScopeTotal } from '@/api/types.ts';
import { AddCashSheet, type CashPhotoChange } from './AddCashSheet.tsx';
import { CashRow } from './CashRow.tsx';
import {
  cashPeriod, customPeriod, monthPeriod, useCashActions, useCashFlow,
  type CashPeriod, type CashPeriodKind,
} from './useCash.ts';

const TABS: CashPeriodKind[] = ['WEEK', 'MONTH', 'YEAR', 'CUSTOM'];

/** The object filter is remembered on this device — a per-viewer convenience, never money state. */
const FILTER_KEY = 'majstr.cash-object';

function readFilter(): CashObjectFilter {
  try {
    return localStorage.getItem(FILTER_KEY) || 'ALL';
  } catch {
    return 'ALL';
  }
}

function writeFilter(value: CashObjectFilter) {
  try {
    if (value === 'ALL') localStorage.removeItem(FILTER_KEY);
    else localStorage.setItem(FILTER_KEY, value);
  } catch {
    /* private mode / storage disabled — the filter just won't be remembered */
  }
}

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
  const [period, setPeriod] = useState<CashPeriod>(() => {
    const sent = location.state as
      { period?: CashPeriodKind; window?: { from: string; to: string } } | null;
    // A door that names its own window wins — the home strip sends the bounds the SERVER answered
    // about, so the screen lands on exactly the figures it showed rather than on a month this
    // device re-derives one timezone away.
    if (sent?.window) {
      return { kind: sent.period ?? 'MONTH', ...sent.window, monthly: false };
    }
    return cashPeriod(sent?.period ?? 'WEEK');
  });
  // A screen left open over midnight kept showing the week it opened on (review P-72). On coming
  // back to it, a period that WAS «this week / month / year» when last seen moves to today's; a
  // custom range or a month drilled into from the year stays where he put it.
  const seenAt = useRef(new Date());
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const before = seenAt.current;
      seenAt.current = new Date();
      setPeriod((p) => {
        if (p.kind === 'CUSTOM' || p.from !== cashPeriod(p.kind, before).from) return p;
        const now = cashPeriod(p.kind);
        return now.from === p.from ? p : now;
      });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  // The custom range lives beside the period, not inside it: the two fields stay filled while he
  // switches to «Місяць» and back, so a second look at the same window is one tap, not four.
  const [range, setRange] = useState<{ from: string; to: string }>(
    () => ({ from: period.from, to: period.to }),
  );
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CashEntryResponse | null>(null);
  // Which object — by default none picked, every row shown (master's call): the filter is a way to
  // LOOK, never a step in front of adding.
  const [object, setObjectState] = useState<CashObjectFilter>(readFilter);
  const [pickingObject, setPickingObject] = useState(false);
  const setObject = (value: CashObjectFilter) => {
    setObjectState(value);
    writeFilter(value);
  };
  const projects = useProjects();
  const qc = useQueryClient();

  const flow = useCashFlow(period, object);
  const actions = useCashActions(period, object);

  // A remembered object that is gone (deleted, or this is another account on the phone) would
  // leave the screen answering 404 forever — fall back to every row once the list says so.
  useEffect(() => {
    if (object === 'ALL' || object === 'NONE' || !projects.data) return;
    if (!projects.data.some((p) => p.id === object)) setObject('ALL');
  }, [object, projects.data]);

  const objectLabel = object === 'ALL'
    ? t('cash.filterAll')
    : object === 'NONE'
      ? t('cash.filterPersonal')
      : projects.data?.find((p) => p.id === object)?.name ?? t('cash.filterAll');

  /**
   * The paper's photo goes up once the row exists. Online only (the sheet disables the picker
   * offline); a refused upload keeps the row and says so — the money is recorded either way.
   */
  const savePhoto = async (id: string, change: CashPhotoChange) => {
    try {
      if (change.file) await cashApi.attachPhoto(id, change.file);
      else if (change.remove) await cashApi.removePhoto(id);
      else return;
      void qc.invalidateQueries({ queryKey: ['cash'] });
    } catch (e) {
      toast.error(toAppError(e).message);
    }
  };

  /**
   * A typed-in date commits only once it IS a date.
   *
   * <p>A `<input type="date">` reports every intermediate year on a keyboard: «0002-09-01»,
   * «0020-09-01», «0202-09-01». Each one was a request, and each ANSWER became its own query key
   * persisted to IndexedDB for a week; above year 9999 the whole screen went to its error state.
   * Ten characters and a floor of 2000 is what a real window looks like (review P-45).</p>
   *
   * <p>A CLEARED field falls back to the OTHER bound rather than sending `''`: an empty string
   * made the server resolve its own default month, so the screen asked about one window and
   * displayed the answer about another.</p>
   */
  const commitRange = (next: { from: string; to: string }) => {
    setRange(next);
    const usable = (v: string) => v.length === 10 && v >= '2000-01-01' && v <= '9999-12-31';
    const from = usable(next.from) ? next.from : next.to;
    const to = usable(next.to) ? next.to : next.from;
    if (usable(from) && usable(to)) setPeriod(customPeriod(from, to));
  };

  /**
   * Which window the numbers below are about, spelled out. After drilling from YEAR into February
   * only «Місяць» is lit, and «Місяць» alone does not say WHICH — the same gap the strip had.
   */
  const windowLabel = period.monthly
    ? String(new Date(period.from + 'T00:00:00').getFullYear())
    : t('cash.window', { from: formatDate(period.from), to: formatDate(period.to) });

  /**
   * «←» goes back to the door he came IN by — the home strip or the Профіль row — not always to one
   * of them. Same `state.from` the shopping list uses.
   *
   * <p>Профіль is the fallback, for a reload or a shared link that carries no state: «Мої гроші» is
   * his own section, and that is where he goes looking for it.</p>
   */
  const back = (location.state as { from?: string } | null)?.from ?? routes.profile;

  const failed = flow.isError && !flow.data;

  // `ph-mask` on the whole screen: every figure on it is the master's own money and every row
  // names an object (review P-25). Nothing here is layout worth watching in a replay.
  return (
    <div className="ph-mask min-h-dvh bg-canvas">
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

        {/* Which window, in words. A money screen may not show three figures with no «за коли». */}
        <p className="mb-3 text-center text-xs text-muted">{windowLabel}</p>

        <button
          type="button"
          onClick={() => setPickingObject(true)}
          aria-label={t('cash.filterLabel')}
          className={
            'mb-4 flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-3 text-sm '
            + (object === 'ALL' ? 'border-border bg-surface text-secondary' : 'border-brand bg-brand-soft text-primary')
          }
        >
          <span className="truncate">🏠 {objectLabel}</span>
          <span aria-hidden className="text-muted">▾</span>
        </button>

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
                onChange={(e) => commitRange({ ...range, from: e.target.value })}
                className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-primary"
              />
            </label>
            <label className="flex-1">
              <span className="mb-1 block text-xs text-muted">{t('cash.rangeTo')}</span>
              <input
                type="date"
                value={range.to}
                min={range.from}
                onChange={(e) => commitRange({ ...range, to: e.target.value })}
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
            <Totals flow={flow.data!} balanceBelow={(flow.data!.materials ?? []).length > 0} />

            {flow.data!.truncated && (
              <p className="mb-3 rounded-xl border border-border bg-surface px-3 py-2 text-xs text-muted">
                {t('cash.truncated', { count: flow.data!.entries.length })}
              </p>
            )}

            {period.monthly && (
              <MonthList months={flow.data!.months} onOpen={(m) => setPeriod(monthPeriod(m))} />
            )}

            {/* Objects and «особисте» apart (master's ask: «дуже важко все побачити»). Each object is
                one line — what it earned in the period and where the client's material money stands —
                and opens into its rows; his own rows sit in their own card below. */}
            {(flow.data!.objects?.length ?? 0) === 0 && flow.data!.personal == null
              && (flow.data!.materials ?? []).length === 0 && !period.monthly ? (
                <EmptyState icon="💰" title={t('cash.emptyTitle')} text={t('cash.emptyText')} />
              ) : (
                <>
                  <ObjectsBlock
                    objects={flow.data!.objects ?? []}
                    balances={flow.data!.materials ?? []}
                    entries={flow.data!.entries}
                    openAll={object !== 'ALL' && object !== 'NONE'}
                    onOpenRow={setEditing}
                    onOpenReceipts={(id) => navigate(routes.receipts(id), { state: { from: routes.cash } })}
                  />
                  <PersonalBlock
                    total={flow.data!.personal ?? null}
                    rows={flow.data!.entries.filter((e) => e.projectId == null)}
                    onOpenRow={setEditing}
                  />
                </>
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

      {/* The sheet closes when the write LANDED, not when it was fired: a refusal belongs under
          the field the master has to fix (review P-20). Offline that is still instant — the op is
          queued and `offlineMutate` resolves — so nothing waits for a van to find signal. */}
      <AddCashSheet
        open={adding}
        onClose={() => setAdding(false)}
        onSubmit={async (req, photo) => {
          const id = await actions.add.mutateAsync(req);
          setAdding(false);
          void savePhoto(id, photo);
        }}
      />
      <AddCashSheet
        open={editing != null}
        entry={editing}
        onClose={() => setEditing(null)}
        onSubmit={async (req, photo) => {
          if (editing) {
            await actions.update.mutateAsync({ id: editing.id, req });
            void savePhoto(editing.id, photo);
          }
          setEditing(null);
        }}
        onDelete={async () => {
          if (editing) await actions.remove.mutateAsync({ id: editing.id, kind: editing.kind });
          setEditing(null);
        }}
      />

      <Modal open={pickingObject} onClose={() => setPickingObject(false)} title={t('cash.filterLabel')}>
        <div className="space-y-1.5">
          {([
            { id: 'ALL', name: t('cash.filterAll') },
            { id: 'NONE', name: t('cash.filterPersonal') },
            ...(projects.data ?? []).map((p) => ({ id: p.id, name: p.name })),
          ]).map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={object === o.id}
              onClick={() => { setObject(o.id); setPickingObject(false); }}
              className={
                'flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm '
                + (object === o.id ? 'bg-brand-soft font-semibold text-primary' : 'bg-surface-sunken text-secondary')
              }
            >
              <span className="truncate">{o.name}</span>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

/** Rows grouped by day, newest first — the server already sorted, so this only cuts the runs. */
function byDay(rows: CashEntryResponse[]) {
  const out: { day: string; rows: CashEntryResponse[] }[] = [];
  for (const e of rows) {
    const last = out[out.length - 1];
    if (last && last.day === e.happenedOn) last.rows.push(e);
    else out.push({ day: e.happenedOn, rows: [e] });
  }
  return out;
}

/** A run of rows under small date headings. EVERY row opens for editing, an object's own included
 *  (master's ruling): a second door to one record, written through that object's own endpoints. */
function DayRows({ rows, onOpenRow }: { rows: CashEntryResponse[]; onOpenRow: (e: CashEntryResponse) => void }) {
  return (
    <>
      {byDay(rows).map((d) => (
        <div key={d.day}>
          <p className="bg-surface-sunken px-3.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {formatDate(d.day)}
          </p>
          {d.rows.map((e) => (
            <CashRow key={e.id} entry={e} hideProject onOpen={() => onOpenRow(e)} />
          ))}
        </div>
      ))}
    </>
  );
}

/**
 * «Обʼєкти»: one line per object — what it earned in the period, and where the client's material
 * money stands (ALL time: a debt does not end with the week). Tapping opens its rows. An object with
 * a material balance but no rows in the period still gets its line, opening its receipts instead.
 */
function ObjectsBlock({ objects, balances, entries, openAll, onOpenRow, onOpenReceipts }: {
  objects: CashScopeTotal[];
  balances: CashMaterialBalance[];
  entries: CashEntryResponse[];
  /** One object is filtered in — show its rows without a tap. */
  openAll: boolean;
  onOpenRow: (e: CashEntryResponse) => void;
  onOpenReceipts: (projectId: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const balanceOf = new Map(balances.map((b) => [b.projectId, b]));
  const lines: { id: string; name: string | null | undefined; total: CashScopeTotal | null }[] = [];
  for (const o of objects) {
    if (o.projectId != null) lines.push({ id: o.projectId, name: o.projectName, total: o });
  }
  for (const b of balances) {
    if (!lines.some((l) => l.id === b.projectId)) lines.push({ id: b.projectId, name: b.projectName, total: null });
  }
  if (lines.length === 0) return null;
  const owed = balances.filter((b) => b.outstanding > 0).reduce((sum, b) => sum + b.outstanding, 0);
  return (
    <section className="mb-4 overflow-hidden rounded-card border border-border bg-surface">
      <p className="flex items-baseline justify-between gap-2 border-b border-border bg-brand-soft px-3.5 py-2.5">
        <span className="text-xs font-bold uppercase tracking-wide text-primary">🏠 {t('cash.objectsTitle')}</span>
        {owed > 0 && (
          <span className="text-xs font-semibold text-warning">
            ⚠ {t('cash.materialsOwedTitle')} {formatMoney(owed)}
          </span>
        )}
      </p>
      {lines.map((line) => {
        const rows = entries.filter((e) => e.projectId === line.id);
        const expanded = openAll || open.has(line.id);
        const balance = balanceOf.get(line.id);
        const toggle = () => {
          if (rows.length === 0) {
            if (balance) onOpenReceipts(line.id);
            return;
          }
          setOpen((prev) => {
            const next = new Set(prev);
            if (next.has(line.id)) next.delete(line.id);
            else next.add(line.id);
            return next;
          });
        };
        return (
          <div key={line.id} className="border-b border-border last:border-b-0">
            <button
              type="button"
              onClick={toggle}
              aria-expanded={rows.length > 0 ? expanded : undefined}
              className="flex min-h-12 w-full items-center gap-2 px-3.5 py-2 text-left"
            >
              {rows.length > 0 && (
                <span
                  aria-hidden
                  className={'w-4 flex-shrink-0 text-center text-lg leading-none text-muted transition-transform ' + (expanded ? 'rotate-90' : '')}
                >
                  ›
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-primary">{line.name ?? t('cash.noObject')}</span>
                {balance && (
                  <span className={'block truncate text-xs ' + (balance.outstanding > 0 ? 'text-warning' : 'text-muted')}>
                    {balance.outstanding > 0
                      ? t('cash.materialsOwes', { amount: formatMoney(balance.outstanding) })
                      : t('cash.materialsLeft', { amount: formatMoney(-balance.outstanding) })}
                  </span>
                )}
              </span>
              {line.total && (
                <span className="flex-shrink-0 text-right">
                  <span className="block text-[11px] text-muted">{t('cash.earnedShort')}</span>
                  <span className="block font-mono text-sm font-bold tabular-nums text-primary">
                    {formatMoney(line.total.earned)}
                  </span>
                </span>
              )}
            </button>
            {expanded && rows.length > 0 && (
              <div className="border-t border-border">
                <DayRows rows={rows} onOpenRow={onOpenRow} />
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/**
 * «Особисте» — the rows no object knows (fuel, tools, taxes, work closed without an act), in their
 * own card so they never read as a job's money. The cards are told apart by their title panel only
 * (master's call: no colour coding beyond it).
 */
function PersonalBlock({ total, rows, onOpenRow }: {
  total: CashScopeTotal | null;
  rows: CashEntryResponse[];
  onOpenRow: (e: CashEntryResponse) => void;
}) {
  const { t } = useTranslation();
  if (total == null && rows.length === 0) return null;
  return (
    <section className="mb-4 overflow-hidden rounded-card border border-border bg-surface">
      <p className="flex items-baseline justify-between gap-2 border-b border-border bg-brand-soft px-3.5 py-2.5">
        <span className="text-xs font-bold uppercase tracking-wide text-primary">👤 {t('cash.personalTitle')}</span>
        {total && (
          <span className="font-mono text-sm font-bold tabular-nums text-primary">{formatMoney(total.earned)}</span>
        )}
      </p>
      <DayRows rows={rows} onOpenRow={onOpenRow} />
    </section>
  );
}

/** «Прийшло» / «Витрачено» / «Заробив» — and the gap between the first and the last, explained. */
function Totals({ flow, balanceBelow }: {
  flow: {
    income: number; expense: number; earned: number; refunds: number;
    objects?: CashScopeTotal[]; personal?: CashScopeTotal | null;
  };
  /** «Клієнти винні за матеріал» is on screen — the line may point at it. */
  balanceBelow: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 rounded-card border border-border bg-surface p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted">{t('cash.income')}</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-success">
          +{formatMoney(flow.income)}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted">{t('cash.expense')}</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-primary">
          −{formatMoney(flow.expense)}
        </span>
      </div>
      <div className="mt-2.5 flex items-baseline justify-between gap-2 border-t border-border pt-2.5">
        <span className="text-sm font-bold text-primary">{t('cash.earned')}</span>
        <span className="font-mono text-base font-extrabold tabular-nums text-primary">
          {formatMoney(flow.earned)}
        </span>
      </div>
      {/* Split only when there IS a split — a week of nothing but jobs needs no «особисте 0». */}
      {flow.personal != null && (flow.objects?.length ?? 0) > 0 && (
        <div className="mt-1 space-y-0.5 text-xs">
          <p className="flex items-baseline justify-between gap-2 pl-3 text-muted">
            <span>{t('cash.earnedObjects')}</span>
            <span className="font-mono tabular-nums">
              {formatMoney((flow.objects ?? []).reduce((sum, o) => sum + o.earned, 0))}
            </span>
          </p>
          <p className="flex items-baseline justify-between gap-2 pl-3 text-muted">
            <span>{t('cash.earnedPersonal')}</span>
            <span className="font-mono tabular-nums">{formatMoney(flow.personal.earned)}</span>
          </p>
        </div>
      )}
      {/* The client's money «на матеріал» arrived but is in none of the three — said, so a payment
          he remembers does not look lost. */}
      {flow.refunds > 0 && (
        <p className="mt-1.5 text-xs text-muted">
          {/* What clients HANDED OVER in the period, not what is left of it — the balance, net of
              the receipts, is the block below. Read as «залишок», the old «Ще 5 000 ₴» looked wrong
              next to a «лишилось 4 236 ₴». */}
          {t('cash.refundsHint', { amount: formatMoney(flow.refunds) })}
          {balanceBelow && ' ' + t('cash.refundsHintBalance')}
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
            {/* `new Date('2026-03-01')` is parsed as UTC, which is February everywhere west of it —
                the row would name the month before the one it totals. */}
            {new Date(m.month + 'T00:00:00').toLocaleDateString('uk-UA', { month: 'long' })}
          </span>
          <span className="ml-auto flex flex-shrink-0 items-baseline gap-2 font-mono text-sm tabular-nums">
            {/* A side with nothing on it is left out — «−0 ₴» read as a spend that went missing. */}
            {m.income > 0 && <span className="text-success">+{formatMoney(m.income)}</span>}
            {m.expense > 0 && <span className="text-muted">−{formatMoney(m.expense)}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
