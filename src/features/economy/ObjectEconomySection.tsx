import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '@/components/Spinner.tsx';
import { UpgradeIntentModal } from '@/features/upgrade/UpgradeIntentModal.tsx';
import { useMe } from '@/features/auth/useMe.ts';
import { TEMP_FREE_GETS_MEASUREMENTS_AND_ECONOMY } from '@/features/plan/tempFreeUnlocks.ts';
import { upgradeApi } from '@/api/upgrade.ts';
import { track } from '@/lib/posthog.ts';
import { formatMoney, formatMoneyExact, formatNumber } from '@/lib/format.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { routes } from '@/lib/config.ts';
import { ActionMenu, ActionMenuItem } from '@/components/ActionMenu.tsx';
import { InfoPopover } from '@/components/InfoPopover.tsx';
import { ProgressStrip, progressPct } from '@/components/ProgressStrip.tsx';
import { estimateName } from '@/features/estimate/estimateName.ts';
import { useEconomy, useToggleEstimateCounted } from './useEconomy.ts';
import { useActs } from '@/features/acts/useActs.ts';
import { actCreateBlock, useNewAct } from '@/features/acts/useNewAct.ts';
import { PaymentsBlock } from './PaymentsBlock.tsx';
import type { CrewMarginResponse, ObjectEconomyActsResponse, ObjectEconomyMaterialsResponse, SignedEstimatePanelResponse } from '@/api/types.ts';

// «Прибуток/Витрати» and the expense journal were parked here behind a flag in August and are now
// GONE for good (crew-margin iteration). The reason they never came back is not the formula's
// arithmetic but its inputs: there is no screen anywhere in the app where a master adds an expense
// AGAINST AN OBJECT — `object_expenses` fills only from an act's receipts and from a till receipt
// flipped to «моя витрата», and crew pay goes into «Мої гроші» as a CREW entry with no object at
// all. Switched on, «Прибуток» would have read ≈ «За договором» for everyone, and would have been
// wrong in the opposite direction for the one бригадир who records everything.
//
// The object keeps money (contract / acts / received) and facts the master typed himself (the
// margin over the crew's prices). The question «скільки я заробив» is answered in «Мої гроші»,
// where it counts everything and where the master asked for it.
//
// The journal's backend CRUD is untouched: «Мої гроші» edits an object's rows through it.

/** A small reference figure (label + amount) in the economy breakdown. */
function EcoRef({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-sm font-bold text-primary">{formatMoney(value)}</div>
      <div className="mt-0.5 text-[11px] text-muted">{label}</div>
    </div>
  );
}

function fmtSignedDate(iso: string): string {
  return new Date(iso).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** The «Надбавка 12% +1 776 ₴ · Знижка 15% −3 900 ₴» recap line — same sign convention as the
 *  black summary panel's `TypeBreakdown` (markup prefixed with «+», discount keeps its natural
 *  minus), so the figures match 1-to-1 wherever this renders.
 *
 *  The percent comes from the SERVER (`markupRate`/`discountRate`) and is not derived here. It
 *  used to be `amount / (works + materials)`, which is the wrong base: a «% від кошторису» line is
 *  measured against its OWN TYPE's subtotal, so a discount the master typed as 15 % printed as
 *  «14,776%». Absent (several lines at different percents, or an older backend) — the amount alone,
 *  which is what the multi-estimate summary panel has always shown and is honest either way. */
function AdjustLine({ markup, discount, markupRate, discountRate }: {
  markup: number; discount: number; markupRate?: number | null; discountRate?: number | null;
}) {
  const { t } = useTranslation();
  if (markup <= 0 && discount >= 0) return null;
  const pct = (rate?: number | null) => (rate == null ? '' : `${formatNumber(Math.abs(rate), 2)}% `);
  const parts = [
    markup > 0 ? `${t('estimate.summaryMarkup')} ${pct(markupRate)}+${formatMoney(markup)}` : null,
    discount < 0 ? `${t('estimate.summaryDiscount')} ${pct(discountRate)}${formatMoney(discount)}` : null,
  ].filter(Boolean);
  return <p className="mt-1 text-[11px] text-muted">{parts.join(' · ')}</p>;
}

/**
 * «Бригаді / Твоя націнка» on a marked-up copy — the бригадир's own half of the money.
 *
 * <p>Neutral, never the green of a profit figure. It is a difference between two prices, not an
 * earning: materials, fuel and everything else the master pays for are no part of it, which the
 * caption says out loud rather than leaving him to assume. A NEGATIVE margin is rendered in the
 * danger colour and with no alarm beyond that — selling a position below the crew's price can be a
 * deliberate decision, and a screen that scolds him for it would be wrong.</p>
 */
function CrewMarginBlock({ margin }: { margin: CrewMarginResponse }) {
  const { t } = useTranslation();
  useEffect(() => track('crew_margin_viewed', { scope: 'economy' }), []);
  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted">{t('economy.crewTotal')}</span>
        <span className="text-sm font-semibold text-primary">{formatMoney(margin.crewTotal)}</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <span className="text-xs text-muted">{t('economy.crewMargin')}</span>
        <span className={`text-sm font-bold ${margin.margin < 0 ? 'text-danger' : 'text-primary'}`}>
          {margin.margin > 0 ? '+' : ''}{formatMoney(margin.margin)}
        </span>
      </div>
      {margin.marginAccepted !== 0 && (
        <div className="mt-0.5 flex items-baseline justify-between pl-3">
          <span className="text-[11px] text-muted">{t('economy.crewMarginAccepted')}</span>
          <span className="text-xs font-semibold text-muted">
            {margin.marginAccepted > 0 ? '+' : ''}{formatMoney(margin.marginAccepted)}
          </span>
        </div>
      )}
      <p className="mt-1.5 text-[11px] leading-snug text-muted">{t('economy.crewMarginHint')}</p>
      {margin.unpricedCount > 0 && (
        <p className="mt-1 text-[11px] leading-snug text-muted">
          {t('economy.crewMarginUnpriced', {
            count: margin.unpricedCount,
            sum: formatMoney(margin.unpricedTotal),
          })}
        </p>
      )}
    </div>
  );
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
            markupRate={panel.markupRate}
            discountRate={panel.discountRate}
          />
          {panel.crewMargin && <CrewMarginBlock margin={panel.crewMargin} />}
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
 * The materials axis (V129) — FREE-visible, and deliberately its OWN axis rather than a line inside
 * {@link ActsAxis}. «Прийнято актами» ⊆ «За договором» counts one estimate set; a receipt joins the
 * contract only when an act picks it up, so folding it in would quietly break that invariant and
 * make the works figures wrong.
 *
 * <p>What it answers is the question the master actually has after the builders' merchant: how much
 * of his money is out there waiting to come back. Own-cost receipts never appear here — they are
 * already object expenses, and counting them twice is exactly the confusion this feature removes.</p>
 *
 * <p>Absent until there is a receipt, like every other card here: a permanent 0 ₴ row is the kind of
 * thing that «збиває з толку», and the door for adding one is the shopping list, not the economy.</p>
 */
function MaterialsAxis({ materials, objectId }: {
  materials: ObjectEconomyMaterialsResponse; objectId: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (materials.receiptCount === 0) return null;
  return (
    // The card is a DIV with the navigate button inside it, and the InfoPopover a SIBLING of that
    // button — the same shape the estimate panel above uses (see its comment). InfoPopover is itself
    // a button, so nested it swallowed the ⓘ tap and navigated to the receipts list instead.
    <div className="w-full rounded-card border border-border bg-surface p-3 text-left">
      <button
        type="button"
        onClick={() =>
          navigate(routes.receipts(objectId), { state: { from: routes.project(objectId) } })
        }
        className="block w-full text-left"
      >
        {/* Phrasing content only: a <div>/<p> inside a <button> is invalid markup. */}
        <span className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">🧾 {t('receipts.axisTitle')}</span>
          {/* Exact, unlike the estimate axes above: this figure is the sum of the very receipts the
              card opens, and that list prints kopecks. Rounded here, the same receivable read
              «13 ₴» on the object and «12,50 ₴» one tap later. */}
          {/* What is still OWED, not what was spent (B-65): a client who has already handed the
              money back was being asked for it again on the very screen that had just counted his
              payment. `reimbursable` stays the gross figure and is shown below when it differs. */}
          <span className="font-mono text-sm font-semibold tabular-nums text-primary">
            {formatMoneyExact(materials.outstanding)}
          </span>
        </span>
      </button>
      <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted">
        <span>
          {t('receipts.axisCount', { count: materials.receiptCount })}
          {materials.refundApplied > 0 && (
            <span className="text-success">
              {' · '}
              {t('receipts.axisRefunded', { amount: formatMoneyExact(materials.refundApplied) })}
            </span>
          )}
          {materials.unpricedCount > 0 && (
            <span className="text-warning">
              {' · '}
              {t('receipts.axisUnpriced', { count: materials.unpricedCount })}
            </span>
          )}
        </span>
        <InfoPopover text={t('receipts.axisInfo')} label={t('receipts.axisTitle')} />
      </p>
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

  const economy = useEconomy(objectId);

  // Act creation reachable from a signed-estimate panel (acts iteration). One shared block reason
  // and one shared create-then-open flow with the Acts tab.
  const acts = useActs(objectId);
  const actList = acts.data ?? [];
  const canGenerateAct = actCreateBlock(actList) === null;
  const newAct = useNewAct(objectId, objectCreatedAt);

  const openTeaser = () => {
    // Historical id, kept on purpose: renaming it would break the analytics series that has been
    // recording PRO interest from this screen since the profit card existed.
    void upgradeApi.click('OBJECT_PROFIT');
    setUpgradeOpen(true);
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

      {/* Materials axis (V129) — FREE-visible for the same reason, and NEVER folded into the works
          figures above: those count one estimate set, this is money spent, not work accepted. */}
      {eco?.materials && <MaterialsAxis materials={eco.materials} objectId={objectId} />}

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
        // The PRO block's own render condition. It used to be `internals`, which the backend nulls
        // for FREE together with `payments` — a fine signal while the profit card was the thing it
        // guarded, and a confusing one now that nothing in here reads `internals` at all. Same
        // nullability, same server-side gate, no backend change: `payments` is what this block
        // actually renders.
        eco?.payments && (
          <>
            <EstimatesSummaryPanel panels={panels} />

            {/* economy-contracted-signed-only-fix once replaced this whole section with a flat
                «ще немає підписаних кошторисів» when nothing was signed. The 0/0/0 noise it was
                removing is real, but it took «+ Платіж» down with it — and an ADVANCE is money
                that arrives before anything is signed, so the first payment a master records had
                no entry point at all. It also keyed off PLAN rows alone, so an object carrying
                only unplanned receipts hid money already recorded. The block now stands down its
                own zero-denominator parts instead (see PaymentsBlock). */}
            {eco?.payments && (
              <PaymentsBlock
                objectId={objectId}
                summary={eco.payments}
                materialsOutstanding={eco.materials.outstanding}
                objectCreatedAt={objectCreatedAt}
              />
            )}

          </>
        )
      )}

      <UpgradeIntentModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
    </section>
  );
}
