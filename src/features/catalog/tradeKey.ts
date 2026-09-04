import type { Trade } from '@/api/types.ts';

/**
 * A trade key — a system {@link Trade}, or `custom:<id>` for a master-invented trade
 * (`user_trade`, V91). Every screen that groups, files or picks a trade keys on this shape: the
 * catalog and template TREES, {@link CatalogItemForm}, save-as-template.
 *
 * <p>It used to live beside the trade filter CHIPS, which were the only consumer when the shape
 * was invented. The chips are gone — every browse surface is a tree now, where a trade is a LEVEL
 * you walk instead of a filter that hides the rest — so the key lives on its own.</p>
 */
export type TradeKey = Trade | `custom:${string}`;

export function customTradeKey(id: string): TradeKey {
  return `custom:${id}`;
}

/** `custom:<id>` → the id, or null for a system-trade key. */
export function parseCustomTradeKey(key: TradeKey): string | null {
  return key.startsWith('custom:') ? key.slice('custom:'.length) : null;
}
