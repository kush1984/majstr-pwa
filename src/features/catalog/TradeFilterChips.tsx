import { useTranslation } from 'react-i18next';
import { Chip } from '@/components/Chip.tsx';
import { TRADE_EMOJI, CUSTOM_TRADE_EMOJI } from '@/lib/labels.ts';
import { TRADE_VALUES } from '@/features/auth/registerSchema.ts';
import type { Trade } from '@/api/types.ts';

/** A selected filter/picker key — a system Trade, or `custom:<id>` for a master-invented
 *  trade (`user_trade`). Shared by the catalog filter, the estimate-template filter, and
 *  any trade picker (`CatalogItemForm`, save-as-template) — they all key on the same shape. */
export type TradeKey = Trade | `custom:${string}`;

export function customTradeKey(id: string): TradeKey {
  return `custom:${id}`;
}

/** `custom:<id>` → the id, or null for a system-trade key. */
export function parseCustomTradeKey(key: TradeKey): string | null {
  return key.startsWith('custom:') ? key.slice('custom:'.length) : null;
}

/** The minimal shape a trade filter/picker needs — a catalog item, a template summary,
 *  anything carrying the system trade + optional custom-trade link. */
export interface TradedEntity {
  trade: Trade | null;
  customTradeId: string | null;
  customTradeName?: string | null;
  /** Other trades that ALSO ship this exact position by name (backend-computed — see
   *  `CatalogItemResponse.sharedTrades`). A catalog item has one row per (name, type, unit), so
   *  a position two of the master's trades both use is filed under whichever claimed it first;
   *  without this, selecting the OTHER trade's chip would hide a real, priced position. Absent
   *  on entities that don't carry this data (e.g. estimate-template summaries) — treated as none. */
  sharedTrades?: readonly Trade[];
}

/**
 * Empty selection = all trades (no filter). A custom-trade entity matches only its own
 * `custom:<id>` key — it is NEVER swept up by the "Інше" (OTHER) chip, even though its
 * `trade` column also reads OTHER (the invariant V91 keeps on both catalog_items and
 * estimate_templates: custom_trade_id set ⇒ trade = OTHER).
 */
export function tradeMatches(entity: TradedEntity, selected: ReadonlySet<TradeKey>): boolean {
  if (selected.size === 0) return true;
  if (entity.customTradeId) return selected.has(customTradeKey(entity.customTradeId));
  if (selected.has(entity.trade == null ? 'OTHER' : entity.trade)) return true;
  return entity.sharedTrades?.some((tr) => selected.has(tr)) ?? false;
}

/**
 * Multi-select trade filter above the type (Усі/Роботи/Матеріали) row. Built from trades
 * ACTUALLY PRESENT in `items` — not the master's profile trades. A trade removed from the
 * profile still shows here as long as positions filed under it remain (nothing should
 * become unfilterable just because he unchecked it), and a custom trade only appears once
 * it has at least one position — otherwise there is nothing to filter to.
 *
 * Click a chip to add it to the filter; click again to remove it. "Усі трейди" clears the
 * selection. Selecting every available chip collapses back to "Усі трейди". Hidden when
 * fewer than two chips would show.
 */
export function TradeFilterChips({
  items,
  value,
  onChange,
}: {
  items: readonly TradedEntity[];
  value: ReadonlySet<TradeKey>;
  onChange: (next: Set<TradeKey>) => void;
}) {
  const { t } = useTranslation();

  const systemPresent = new Set<Trade>();
  const customPresent = new Map<string, string>(); // id -> name
  for (const item of items) {
    if (item.customTradeId) {
      customPresent.set(item.customTradeId, item.customTradeName ?? '');
    } else {
      systemPresent.add(item.trade ?? 'OTHER');
    }
    // A shared position (see TradedEntity.sharedTrades) makes its OTHER trade's chip clickable
    // even on the rare catalog where nothing is directly tagged with that trade yet.
    for (const tr of item.sharedTrades ?? []) systemPresent.add(tr);
  }
  const systemChips = TRADE_VALUES.filter((tr) => systemPresent.has(tr));
  const customChips = [...customPresent.entries()].sort((a, b) => a[1].localeCompare(b[1], 'uk'));
  const total = systemChips.length + customChips.length;
  if (total < 2) return null;

  const toggle = (key: TradeKey) => {
    const next = new Set(value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    // Every chip selected = nothing actually filtered → fall back to "Усі трейди".
    onChange(next.size >= total ? new Set() : next);
  };

  return (
    <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
      <Chip active={value.size === 0} onClick={() => onChange(new Set())}>
        {t('catalog.allTrades')}
      </Chip>
      {systemChips.map((tr) => (
        <Chip key={tr} active={value.has(tr)} onClick={() => toggle(tr)}>
          {TRADE_EMOJI[tr]} {t('trades.' + tr)}
        </Chip>
      ))}
      {customChips.map(([id, name]) => (
        <Chip key={id} active={value.has(customTradeKey(id))} onClick={() => toggle(customTradeKey(id))}>
          {CUSTOM_TRADE_EMOJI} {name}
        </Chip>
      ))}
    </div>
  );
}
