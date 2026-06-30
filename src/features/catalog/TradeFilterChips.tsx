import { useTranslation } from 'react-i18next';
import { Chip } from '@/components/Chip.tsx';
import { TRADE_EMOJI } from '@/lib/labels.ts';
import type { Trade } from '@/api/types.ts';

/** A selected trade key. "No specific trade" is OTHER ("Інше") — the single
 *  catch-all; there is no separate untagged bucket. */
export type TradeKey = Trade;

/**
 * Empty selection = all trades (no filter). Otherwise an item matches when its
 * trade is in the selected set. A null trade (defensive — the backend stores
 * OTHER) counts as OTHER.
 */
export function tradeMatches(itemTrade: Trade | null, selected: ReadonlySet<TradeKey>): boolean {
  if (selected.size === 0) return true;
  return selected.has(itemTrade == null ? 'OTHER' : itemTrade);
}

/**
 * Multi-select trade filter above the type (Усі/Роботи/Матеріали) row. Click a
 * trade to add it to the filter; click it again to remove it (its positions
 * drop out). "Усі трейди" clears the selection. Selecting every available chip
 * collapses back to "Усі трейди". Hidden when fewer than two chips would show.
 * "Інше" (OTHER) is the single catch-all chip — shown when the master has the
 * OTHER trade OR some position is OTHER.
 */
export function TradeFilterChips({
  userTrades,
  hasOther,
  value,
  onChange,
}: {
  userTrades: Trade[];
  hasOther: boolean;
  value: ReadonlySet<TradeKey>;
  onChange: (next: Set<TradeKey>) => void;
}) {
  const { t } = useTranslation();

  // One "Інше" = OTHER. Show it if the master has it or some item is OTHER; dedupe.
  const chips: Trade[] = [...userTrades];
  if (hasOther && !chips.includes('OTHER')) chips.push('OTHER');
  if (chips.length < 2) return null;

  const toggle = (key: TradeKey) => {
    const next = new Set(value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    // Every chip selected = nothing actually filtered → fall back to "Усі трейди".
    onChange(next.size >= chips.length ? new Set() : next);
  };

  return (
    <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
      <Chip active={value.size === 0} onClick={() => onChange(new Set())}>
        {t('catalog.allTrades')}
      </Chip>
      {chips.map((tr) => (
        <Chip key={tr} active={value.has(tr)} onClick={() => toggle(tr)}>
          {TRADE_EMOJI[tr]} {t('trades.' + tr)}
        </Chip>
      ))}
    </div>
  );
}
