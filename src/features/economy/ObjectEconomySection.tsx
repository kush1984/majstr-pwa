import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '@/components/Spinner.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { UpgradeIntentModal } from '@/features/upgrade/UpgradeIntentModal.tsx';
import { useMe } from '@/features/auth/useMe.ts';
import { TEMP_FREE_GETS_MEASUREMENTS_AND_ECONOMY } from '@/features/plan/tempFreeUnlocks.ts';
import { upgradeApi } from '@/api/upgrade.ts';
import { formatMoney, formatNumber } from '@/lib/format.ts';
import { cn } from '@/lib/cn.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { routes } from '@/lib/config.ts';
import { ActionMenu, ActionMenuItem } from '@/components/ActionMenu.tsx';
import { InfoPopover } from '@/components/InfoPopover.tsx';
import { ProgressStrip, progressPct } from '@/components/ProgressStrip.tsx';
import { estimateName } from '@/features/estimate/estimateName.ts';
import { useEconomy, useExpenses, useDeleteExpense, useToggleEstimateCounted } from './useEconomy.ts';
import { useActs } from '@/features/acts/useActs.ts';
import { actCreateBlock, useNewAct } from '@/features/acts/useNewAct.ts';
import { ExpenseSheet } from './ExpenseSheet.tsx';
import { PaymentsBlock } from './PaymentsBlock.tsx';
import type { ExpenseCategory, ExpenseResponse, ObjectEconomyActsResponse, SignedEstimatePanelResponse } from '@/api/types.ts';

// Прибуток/Витрати (+ the expense journal) is deliberately hidden from the UI for now
// (economy-hide-internals iteration, after a live trial): today's formula — `profit = contracted
// − Σ all expenses` — reads as an honest "заробіток" but isn't one, since it never accounts for
// what the master actually pays a crew unless he remembers to log it as a LABOR expense. Backend
// (`internals` on `ObjectEconomyResponse`, the expense-journal CRUD) stays fully live — only this
// component stops rendering it and stops fetching the expense list, so re-enabling is a one-line
// flip. Same pattern as REOPEN_ENABLED / the old UNFORESEEN_EXPENSES_ENABLED.
const INTERNALS_ENABLED: boolean = false;

const CAT_ICON: Record<ExpenseCategory, string> = { MATERIALS: '🧱', LABOR: '🔨', OTHER: '•' };

/** A small reference figure (label + amount) in the economy breakdown. */
function EcoRef({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-sm font-bold text-primary">{formatMoney(value)}</div>
      <div className="mt-0.5 text-[11px] text-muted">{label}</div>
    </div>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
}

function fmtSignedDate(iso: string): string {
  return new Date(iso).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** The «Надбавка 12% +1 776 ₴ · Знижка 15% −3 900 ₴» recap line — same sign convention as the
 *  black summary panel's `TypeBreakdown` (markup prefixed with «+», discount keeps its natural
 *  minus), so the figures match 1-to-1 wherever this renders.
 *
 *  `base` (optional — the pre-adjustment subtotal, `works + materials`; both already gross since
 *  `SignedEstimatePanelResponse` backs the adjustment OUT of them, same as `TypeBreakdown`) turns
 *  on a percent, computed the same way `TypeBreakdown` derives its own («amount / base × 100»,
 *  economy-polish iteration). Omitted on the multi-estimate summary panel below: markup/discount
 *  there can come from several estimates at different percentages, and a single blended % would
 *  be a number nobody's estimate actually carries — sum-only is honest, a fabricated % isn't. */
function AdjustLine({ markup, discount, base }: { markup: number; discount: number; base?: number }) {
  const { t } = useTranslation();
  if (markup <= 0 && discount >= 0) return null;
  const pct = (amount: number) => (base && base > 0 ? `${formatNumber((amount / base) * 100, 2)}% ` : '');
  const parts = [
    markup > 0 ? `${t('estimate.summaryMarkup')} ${pct(markup)}+${formatMoney(markup)}` : null,
    discount < 0 ? `${t('estimate.summaryDiscount')} ${pct(-discount)}${formatMoney(discount)}` : null,
  ].filter(Boolean);
  return <p className="mt-1 text-[11px] text-muted">{parts.join(' · ')}</p>;
}

/** One SIGNED-estimate panel: lock icon, signed date, works/materials/total. (Acts iteration
 *  renamed the old "act" framing here — a real «Акт виконаних робіт» is now a separate document in
 *  the Акти tab; these panels are signed ESTIMATES.) Shows for every SIGNED estimate regardless of
 *  `countedInEconomy` (the master sees every deal he actually signed); a panel excluded from the
 *  totals below says so honestly instead of the numbers silently disagreeing. Clickable
 *  (economy-rework iteration): opens the same read-only estimate view the (now-removed-from-here)
 *  Кошторис tab used to — `EstimateEditorPage` already renders a SIGNED estimate read-only.
 *
 *  <p>The ⋮ menu (economy-polish iteration) is the ONLY place "враховувати в економіці" is still
 *  editable — the Кошторис-tab checkbox moved here, since a signed estimate is the one point where
 *  the toggle has something to act on. Two sibling elements (main button + menu trigger), not one
 *  button containing another — {@link ActionMenu}'s trigger is itself a `<button>`.</p> */
function EstimatePanel({ panel, objectId, canGenerate, onGenerate }: {
  panel: SignedEstimatePanelResponse; objectId: string; canGenerate: boolean; onGenerate: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toggle = useToggleEstimateCounted(objectId);

  const isAddendum = panel.kind === 'ADDENDUM';

  const onToggle = () => {
    toggle.mutate(
      { estimateId: panel.id, value: !panel.countedInEconomy },
      { onError: (err) => toast.error(toAppError(err).message) },
    );
  };

  return (
    <div className="rounded-card border border-border border-l-4 border-l-brand-soft-2 bg-surface">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => navigate(`${routes.estimate(panel.id)}?from=economy`)}
          className="min-w-0 flex-1 p-3 text-left transition-transform active:scale-[0.99]"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden>🔒</span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-primary">
              {estimateName(panel.name, panel.signedAt)}
            </span>
            {/* Auto-created rollup («Додаткові роботи до акта № N») — badge it so it doesn't read
                as an estimate the master forgot creating (economy-review). */}
            {isAddendum && (
              <span className="flex-shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] font-semibold text-muted">
                {t('economy.addendumBadge')}
              </span>
            )}
            <span className="flex-shrink-0 text-xs text-muted">{fmtSignedDate(panel.signedAt)}</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <EcoRef label={t('economy.works')} value={panel.works} />
            <EcoRef label={t('economy.materials')} value={panel.materials} />
            <EcoRef label={t('economy.total')} value={panel.total} />
          </div>
          <AdjustLine
            markup={panel.markup}
            discount={panel.discount}
            base={panel.works + panel.materials}
          />
        </button>
        {/* An ADDENDUM rollup («Додаткові роботи до акта № N») offers NEITHER action, so it gets no
            ⋮ at all — both were dead ends on it. «Згенерувати акт»: WorkActService.progress skips
            ADDENDUM estimates, so a scoped editor would open with no positions — and rightly, this
            money IS an act already; billing it again would double it. «Не враховувати»: the server
            answers 409 ESTIMATE_ADDENDUM_LOCKED, because the act's off-estimate lines and re-billed
            receipts count in «Прийнято актами» regardless of the flag — unticking the rollup would
            push the ratio past 100 %. */}
        {!isAddendum && (
          <ActionMenu ariaLabel={t('estimate.actions')}>
            {(close) => (
              <>
                {/* Context entry to act creation — the main one the master asked for. Hidden when
                    another act is open or a FINAL already closed the object (same block as the Acts
                    tab button). Generated from here the editor is SCOPED to this one estimate's
                    positions; the Acts-tab button spans every signed estimate instead. */}
                {canGenerate && (
                  <ActionMenuItem
                    icon="📑"
                    label={t('acts.generate')}
                    onClick={() => { close(); onGenerate(); }}
                  />
                )}
                <ActionMenuItem
                  icon={panel.countedInEconomy ? '🚫' : '✓'}
                  label={panel.countedInEconomy ? t('economy.excludeAct') : t('economy.includeAct')}
                  onClick={() => { close(); onToggle(); }}
                />
              </>
            )}
          </ActionMenu>
        )}
      </div>
      {/* A SIBLING of the navigate button, not nested inside it — InfoPopover is itself a button,
          and a button inside a button swallows taps (same class of bug the ⋮ menu already avoids
          by being a sibling too). */}
      {!panel.countedInEconomy && (
        <p className="flex items-center gap-1 px-3 pb-3 text-[11px] text-muted">
          {t('economy.notCountedNote')}
          <InfoPopover text={t('economy.notCountedInfo')} label={t('economy.notCountedNote')} />
        </p>
      )}
    </div>
  );
}

/** Σ over every SIGNED estimate that's counted in the economy — one grand total above Платежі,
 *  FREE-visible (these are estimate sums, not profit). Absent when nothing is counted, so it
 *  never shows a misleading all-zero card. */
function EstimatesSummaryPanel({ panels }: { panels: SignedEstimatePanelResponse[] }) {
  const { t } = useTranslation();
  const counted = panels.filter((p) => p.countedInEconomy);
  if (counted.length === 0) return null;
  const sum = (pick: (p: SignedEstimatePanelResponse) => number) =>
    counted.reduce((s, p) => s + pick(p), 0);
  return (
    <div className="rounded-card border border-brand-soft-2 bg-brand-soft p-3">
      <h3 className="text-[13px] font-bold text-primary">{t('economy.summaryTitle')}</h3>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <EcoRef label={t('economy.works')} value={sum((p) => p.works)} />
        <EcoRef label={t('economy.materials')} value={sum((p) => p.materials)} />
        <EcoRef label={t('economy.total')} value={sum((p) => p.total)} />
      </div>
      <AdjustLine markup={sum((p) => p.markup)} discount={sum((p) => p.discount)} />
    </div>
  );
}

/** The works axis (acts iteration) — FREE-visible: how much of the contract the client has accepted
 *  via SIGNED acts, next to how much money landed. Two PaymentStrip-twin lines against «За договором»
 *  + a balance line whose wording flips by sign. Absent when there's nothing at all to show. */
function ActsAxis({ acts }: { acts: ObjectEconomyActsResponse }) {
  const { t } = useTranslation();
  const { contracted, acceptedByActs, received } = acts;
  if (contracted === 0 && acceptedByActs === 0 && received === 0) return null;
  const diff = acceptedByActs - received;
  // Work still under contract but not yet closed by acts — the figure the master keeps re-deriving
  // in his head; name it inside the «Прийнято актами» hint (acts-fix, Chunk C).
  const notYetAccepted = Math.max(0, contracted - acceptedByActs);
  const balanceLabel = diff < 0 ? t('economy.unearnedAdvance')
    : diff > 0 ? t('economy.clientDebt') : t('economy.balanced');
  // The balance line is one of two DIFFERENT debts; explain which via the same InfoPopover pattern.
  const balanceInfo = diff < 0 ? t('economy.unearnedAdvanceInfo')
    : diff > 0 ? t('economy.clientDebtInfo') : undefined;
  return (
    <div className="rounded-card border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{t('economy.contracted')}</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-primary">{formatMoney(contracted)}</span>
      </div>
      <AxisStrip label={t('economy.acceptedByActs')} value={acceptedByActs} total={contracted}
        info={t('economy.acceptedInfo', { amount: formatMoney(notYetAccepted) })} />
      <AxisStrip label={t('economy.received')} value={received} total={contracted} />
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2">
        <span className="flex items-center gap-1 text-xs font-medium text-secondary">
          {balanceLabel}
          {balanceInfo && <InfoPopover text={balanceInfo} label={balanceLabel} />}
        </span>
        <span className="font-mono text-sm font-bold tabular-nums text-primary">{formatMoney(Math.abs(diff))}</span>
      </div>
    </div>
  );
}

/** Twin of PaymentStrip — same label shape, same shared {@link ProgressStrip} bar underneath. */
function AxisStrip({ label, value, total, info }: {
  label: string; value: number; total: number; info?: string;
}) {
  const pct = progressPct(value, total);
  return (
    <div className="mt-2">
      <p className="flex flex-wrap items-center gap-1 text-xs text-muted">
        <span className="font-mono tabular-nums">
          {label} {formatMoney(value)}
          <span className="text-faint"> · {pct}%</span>
        </span>
        {info && <InfoPopover text={info} label={label} />}
      </p>
      <ProgressStrip value={value} total={total} />
    </div>
  );
}

/**
 * Object economy tab. Two tiers (economy-polish iteration tightened the split):
 * <ul>
 *   <li><b>FREE + PRO, always real data:</b> per-SIGNED-estimate act panels, clickable → the
 *       read-only estimate view. "Here are the deals I've signed" — the one thing every plan
 *       sees.</li>
 *   <li><b>PRO only, one lock teaser:</b> the Σ summary panel and the payment schedule, behind a
 *       SINGLE gate — temporarily open to FREE too, see {@link TEMP_FREE_GETS_MEASUREMENTS_AND_ECONOMY}.
 *       Прибуток/Витрати (+ the expense journal) used to be a third piece here but is parked for
 *       now — see {@code INTERNALS_ENABLED} above.</li>
 * </ul>
 * Owner-only; nothing here reaches the client (see PublicPortalView instead).
 */
export function ObjectEconomySection({ objectId, objectCreatedAt }: { objectId: string; objectCreatedAt?: string }) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const isPro = TEMP_FREE_GETS_MEASUREMENTS_AND_ECONOMY || (me?.plan ?? 'FREE') !== 'FREE';

  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseResponse | null>(null);
  const [deleting, setDeleting] = useState<ExpenseResponse | null>(null);

  const economy = useEconomy(objectId);
  // No point fetching the expense journal while it's not rendered (INTERNALS_ENABLED).
  const expenses = useExpenses(objectId, isPro && INTERNALS_ENABLED);
  const del = useDeleteExpense(objectId);

  // Act creation reachable from a signed-estimate panel (acts iteration). One shared block reason
  // and one shared create-then-open flow with the Acts tab.
  const acts = useActs(objectId);
  const actList = acts.data ?? [];
  const canGenerateAct = actCreateBlock(actList) === null;
  const newAct = useNewAct(objectId, objectCreatedAt);

  const openTeaser = () => {
    void upgradeApi.click('OBJECT_PROFIT');
    setUpgradeOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await del.mutateAsync(deleting.id);
      setDeleting(null);
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  if (economy.isPending) {
    return (
      <div className="py-8 text-center">
        <Spinner />
      </div>
    );
  }

  const eco = economy.data;
  const panels = eco?.estimates ?? [];
  const internals = eco?.internals ?? null;
  const list = expenses.data ?? [];

  // Session-replay masking: everything inside is redacted in the recording (lib/posthog.ts).
  return (
    <section className="ph-mask space-y-3">
      {panels.length > 0 && (
        <div className="space-y-2">
          {panels.map((p) => (
            <EstimatePanel
              key={p.id}
              panel={p}
              objectId={objectId}
              canGenerate={canGenerateAct}
              onGenerate={() => newAct.start(actList, p.id)}
            />
          ))}
        </div>
      )}

      {/* Works axis (acts iteration) — FREE-visible, computed unconditionally by the backend. */}
      {eco?.acts && <ActsAxis acts={eco.acts} />}

      {/* economy-polish: FREE stops at the acts list above now — the summary/payments/internals
          trio is ONE PRO-locked block, not three separate gates. Backend nulls payments AND
          internals together for FREE, so `internals` doubles as the single check here. */}
      {!isPro ? (
        <button
          type="button"
          onClick={openTeaser}
          className="flex w-full items-center gap-3 rounded-card border border-dashed border-border bg-surface p-4 text-left"
        >
          <span className="text-2xl">🔒</span>
          <span className="flex-1">
            <span className="block text-sm font-semibold text-primary">{t('economy.teaser')}</span>
            <span className="mt-0.5 block text-xs font-bold text-brand">{t('economy.openPro')}</span>
          </span>
        </button>
      ) : (
        internals && (
          <>
            <EstimatesSummaryPanel panels={panels} />

            {/* economy-contracted-signed-only-fix: with contracted now correctly 0 for an object
                with nothing SIGNED yet, a PaymentsBlock full of 0/0/0 is noise rather than
                information — show a neutral empty state instead, UNLESS the master already
                created payment rows by hand (those stay visible as-is, per the prompt). */}
            {eco?.payments && (panels.length > 0 || eco.payments.payments.length > 0) ? (
              <PaymentsBlock objectId={objectId} summary={eco.payments} objectCreatedAt={objectCreatedAt} />
            ) : eco?.payments ? (
              <p className="rounded-card border border-dashed border-border bg-surface p-3 text-center text-sm text-muted">
                {t('economy.paymentsEmpty')}
              </p>
            ) : null}

            {/* economy-hide-internals: Прибуток/Витрати + the expense journal are parked (see
                INTERNALS_ENABLED above) — today's profit formula reads as an honest "заробіток"
                but isn't one yet. */}
            {INTERNALS_ENABLED && (
              <>
                {/* Ink-tinted, not a plain white card — the "internal kitchen" (profit/expenses)
                    is deliberately a different tone from the client-facing acts/summary/payments
                    above, so the eye reads it as a separate tier without needing a divider line
                    to say so. */}
                <div className="rounded-card border border-ink/10 bg-ink/5 p-3 shadow-card">
                  <div className="mb-2 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(null);
                        setSheetOpen(true);
                      }}
                      className="text-[13px] font-semibold text-brand"
                    >
                      {t('economy.addExpenseShort')}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-xl bg-surface-sunken p-2">
                      <div className={cn('text-base font-extrabold', internals.profit < 0 ? 'text-danger' : 'text-brand')}>
                        {formatMoney(internals.profit)}
                      </div>
                      <div className="mt-0.5 text-[11px] font-semibold text-primary">{t('economy.profit')}</div>
                    </div>
                    <div className="rounded-xl bg-surface-sunken p-2">
                      <div className="text-base font-extrabold text-primary">{formatMoney(internals.expenses)}</div>
                      <div className="mt-0.5 text-[11px] font-semibold text-primary">{t('economy.expenses')}</div>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {list.map((e) => (
                    <div key={e.id} className="flex items-stretch rounded-xl border border-border bg-surface">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(e);
                          setSheetOpen(true);
                        }}
                        className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left"
                      >
                        <span className="text-lg">{CAT_ICON[e.category]}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-primary">{formatMoney(e.amount)}</span>
                          <span className="block truncate text-xs text-muted">
                            {fmtDate(e.spentAt)}
                            {e.note ? ` · ${e.note}` : ''}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={t('common.delete')}
                        onClick={() => setDeleting(e)}
                        className="flex items-center border-l border-border px-3 text-muted"
                      >
                        🗑
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )
      )}

      <ExpenseSheet open={sheetOpen} onClose={() => setSheetOpen(false)} objectId={objectId} editing={editing} />
      <ConfirmDialog
        open={deleting !== null}
        title={t('economy.deleteTitle')}
        message={t('economy.deleteMessage')}
        confirmLabel={t('common.delete')}
        loading={del.isPending}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
      <UpgradeIntentModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
    </section>
  );
}
