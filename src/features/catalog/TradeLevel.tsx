import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn.ts';
import { TRADE_EMOJI, CUSTOM_TRADE_EMOJI } from '@/lib/labels.ts';
import { parseCustomTradeKey, type TradeKey } from './tradeKey.ts';
import type { Trade } from '@/api/types.ts';

/**
 * How a trade names itself in a tree. A custom trade with no name left is still a real branch —
 * it reads OTHER underneath (V91), which is the honest label for it.
 */
export function tradeBranchLabel(
  key: TradeKey,
  customName: string | null | undefined,
  t: (k: string) => string,
): string {
  return parseCustomTradeKey(key) !== null
    ? (customName?.trim() ?? '') || t('trades.OTHER')
    : t('trades.' + key);
}

/**
 * The trade LEVEL of every tree in the product — the catalog picker, the template picker, the
 * catalog page and the templates page. It was copied three times before this component existed and
 * the fourth copy is what forced the extraction: «якщо десь той самий чи подібний функціонал…
 * ідеально виклики мати з одного місця».
 *
 * <p>Presentational only. Open state, the auto-open rule and what a branch CONTAINS all stay with
 * the caller — the four screens legitimately disagree about those and only agree about the
 * chrome.</p>
 *
 * <p><b>`show={false}` draws no header at all</b> and returns the body alone: a single branch has
 * nothing for a trade level to disambiguate, so it is not drawn and its contents sit at the top
 * level (the rule the chips already had — they hid themselves under two trades).</p>
 */
export function TradeLevel({
  show,
  tradeKey,
  customName,
  count,
  badge = 0,
  open,
  onToggle,
  testId,
  leading,
  bodyClass = 'space-y-1.5',
  children,
}: {
  /** False = one branch only: render the children bare, with no header and no rail. */
  show: boolean;
  tradeKey: TradeKey;
  customName?: string | null;
  /** How many rows the branch holds — shown muted at the end of the header. */
  count: number;
  /** Picked/ticked inside this branch. A closed branch must still say it holds some, or a
   *  selection spanning two trades looks like it was lost when the master browses on. */
  badge?: number;
  open: boolean;
  /** Absent = the header is inert (searching: every level stays open, so a collapsed branch can
   *  never swallow a hit). */
  onToggle?: () => void;
  /** Kept per surface so each screen's tests still address their own tree. */
  testId: string;
  /** Rendered BESIDE the header button, never inside it — a button inside a button is invalid
   *  markup. This is where a whole-trade selection tick goes. */
  leading?: ReactNode;
  /** Spacing of the branch body; folders want more air between them than rows do. */
  bodyClass?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const custom = parseCustomTradeKey(tradeKey) !== null;
  const label = tradeBranchLabel(tradeKey, customName, t);

  const body = (
    <div
      className={cn(
        bodyClass,
        // A thin rail, not an indent: at 375px every level of padding is width the name loses,
        // and the name is the thing being read.
        show && 'mt-1.5 border-l-2 border-brand-soft pl-2',
      )}
    >
      {children}
    </div>
  );

  if (!show) return body;

  return (
    <section>
      <div className="flex items-center gap-1">
        {leading}
        <button
          type="button"
          data-testid={testId}
          onClick={onToggle}
          disabled={onToggle == null}
          aria-expanded={open}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl bg-brand-soft px-3.5 py-2.5 text-left"
        >
          {onToggle && (
            <span
              aria-hidden
              className={cn('text-[10px] text-muted transition-transform', open && 'rotate-90')}
            >
              ▶
            </span>
          )}
          <span aria-hidden>{custom ? CUSTOM_TRADE_EMOJI : TRADE_EMOJI[tradeKey as Trade]}</span>
          <span className="min-w-0 flex-1 break-words text-sm font-bold text-primary">{label}</span>
          {badge > 0 && (
            <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-white">
              {badge}
            </span>
          )}
          <span className="text-xs font-semibold text-muted">{count}</span>
        </button>
      </div>
      {open && body}
    </section>
  );
}
