import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { routes } from '@/lib/config.ts';
import { formatMoney } from '@/lib/format.ts';
import { useCashSummary } from './useCash.ts';

/**
 * «Цей тиждень: +42 000 −18 500 ›» — the master's own money on the home screen.
 *
 * <p><b>A strip, not a card, and that is the whole design.</b> The dashboard already carries a
 * greeting, trade chips, three metric tiles, the shopping card, recent objects and quick actions;
 * one more full card and the bottom of that screen stops being read. One row is ~44 px against a
 * card's ~120, which is also exactly a thumb target.</p>
 *
 * <p>It renders nothing when nothing moved this week — the same rule the shopping card follows
 * when there is nothing left to buy. A master who has never opened this feature sees no trace of
 * it on his home screen.</p>
 *
 * <p><b>The WEEK, because that is the period the screen opens on.</b> A strip summing a month over
 * a screen showing a week means tapping «+42 000» lands on 8 000 — two surfaces describing the same
 * money and disagreeing, which is the one thing a money screen may not do.</p>
 */
export function CashHomeStrip() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const summary = useCashSummary();

  if (!summary.data?.hasEntries) return null;
  return (
    <button
      type="button"
      onClick={() => navigate(routes.cash, { state: { from: routes.home } })}
      className="mb-6 flex min-h-11 w-full items-center gap-3 rounded-card border border-border bg-surface px-3.5 py-2.5 text-left"
    >
      <span className="text-base leading-none" aria-hidden>💰</span>
      <span className="truncate text-sm font-semibold text-primary">{t('cash.thisWeek')}</span>
      <span className="ml-auto flex flex-shrink-0 items-baseline gap-2 font-mono text-sm tabular-nums">
        <span className="text-success">+{formatMoney(summary.data.income)}</span>
        <span className="text-muted">−{formatMoney(summary.data.expense)}</span>
      </span>
      <span className="flex-shrink-0 text-muted" aria-hidden>›</span>
    </button>
  );
}
