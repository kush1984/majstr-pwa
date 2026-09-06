import { useTranslation } from 'react-i18next';
import type { Trade } from '@/api/types.ts';

/**
 * A small labelled chip naming a trade. Rendered next to a category header on the estimate board
 * (and the client portal) ONLY when the estimate carries ≥ 2 distinct non-null trades — the
 * grouping is meaningful when there are several to tell apart, and pure noise on a single-trade
 * sheet (which is ~95 % of estimates).
 *
 * <p>Colours are stable per trade, chosen so no two adjacent trades in the enum order share a hue.
 * A soft background + saturated text keeps the badge visible on both the master's brand-heavy
 * header row and the client's neutral portal row.</p>
 */

const CLASS_BY_TRADE: Record<Trade, string> = {
  ELECTRICAL: 'bg-amber-100 text-amber-800',
  PLUMBING:   'bg-sky-100 text-sky-800',
  TILING:     'bg-rose-100 text-rose-800',
  BUILDER:    'bg-stone-200 text-stone-800',
  PAINTER:    'bg-violet-100 text-violet-800',
  DRYWALL:    'bg-emerald-100 text-emerald-800',
  FLOORING:   'bg-orange-100 text-orange-800',
  DEMOLITION: 'bg-red-100 text-red-800',
  METAL:      'bg-slate-200 text-slate-800',
  GENERAL:    'bg-blue-100 text-blue-800',
  OTHER:      'bg-neutral-200 text-neutral-700',
};

export function TradeBadge({ trade }: { trade: Trade }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold normal-case ${CLASS_BY_TRADE[trade]}`}
      title={t('trades.' + trade)}
    >
      {t('trades.' + trade)}
    </span>
  );
}
