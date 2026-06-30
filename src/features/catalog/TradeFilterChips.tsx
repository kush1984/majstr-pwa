import { useTranslation } from 'react-i18next';
import { Chip } from '@/components/Chip.tsx';
import { TRADE_EMOJI } from '@/lib/labels.ts';
import type { Trade } from '@/api/types.ts';

/** A selected trade key: a `Trade`, or `'NULL'` for untagged ("Інше"). */
export type TradeKey = Trade | 'NULL';

/**
 * Empty selection = all trades (no filter). Otherwise an item matches when its
 * trade — or `'NULL'` when it has none — is in the selected set.
 */
export function tradeMatches(itemTrade: Trade | null, selected: ReadonlySet<TradeKey>): boolean {
  if (selected.size === 0) return true;
  return selected.has(itemTrade == null ? 'NULL' : itemTrade);
}

/**
 * Multi-select trade filter above the type (Усі/Роботи/Матеріали) row. Click a
 * trade to add it to the filter; click it again to remove it (its positions
 * drop out). "Усі трейди" clears the selection. Selecting every available chip
 * collapses back to "Усі трейди" (nothing is filtered, so don't pretend it is).
 * Hidden for a single-trade master. "Інше" appears only when some position has
 * no trade tag (legacy or manually-added items).
 */
export function TradeFilterChips({
  userTrades,
  hasUntagged,
  value,
  onChange,
}: {
  userTrades: Trade[];
  hasUntagged: boolean;
  value: ReadonlySet<TradeKey>;
  onChange: (next: Set<TradeKey>) => void;
}) {
  const { t } = useTranslation();
  if (userTrades.length < 2) return null;

  const allKeys: TradeKey[] = [...userTrades, ...(hasUntagged ? (['NULL'] as TradeKey[]) : [])];
  const toggle = (key: TradeKey) => {
    const next = new Set(value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    // Every chip selected = nothing actually filtered → fall back to "Усі трейди".
    onChange(next.size >= allKeys.length ? new Set() : next);
  };

  return (
    <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
      <Chip active={value.size === 0} onClick={() => onChange(new Set())}>
        {t('catalog.allTrades')}
      </Chip>
      {userTrades.map((tr) => (
        <Chip key={tr} active={value.has(tr)} onClick={() => toggle(tr)}>
          {TRADE_EMOJI[tr]} {t('trades.' + tr)}
        </Chip>
      ))}
      {hasUntagged && (
        <Chip active={value.has('NULL')} onClick={() => toggle('NULL')}>
          {t('catalog.otherTrade')}
        </Chip>
      )}
    </div>
  );
}
