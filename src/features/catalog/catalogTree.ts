import type { CatalogItemResponse } from '@/api/types.ts';
import { TRADE_VALUES } from '@/features/auth/registerSchema.ts';
import { toSections, type Section } from '@/features/estimate/estimateArrange.ts';
import { customTradeKey, type TradeKey } from './tradeKey.ts';
import { catalogSectionRank } from './sharedCategory.ts';

/** One trade and everything the master's catalog holds under it, already grouped into folders. */
export interface TradeBranch {
  key: TradeKey;
  /** The master's own name for a `custom:<id>` trade; null for a system one, whose label the
   *  caller translates from the key (the tree stays free of i18n). */
  customName: string | null;
  sections: Section<CatalogItemResponse>[];
  /** Positions in THIS branch. Not a share of the catalog total — a position two trades both
   *  ship is counted in both, because it genuinely belongs to both. */
  count: number;
}

/** Which trade a row is STORED under. A custom-trade row reads OTHER underneath (V91), so the
 *  custom id has to win — the same rule `tradeMatches` keeps for the chips. */
export function tradeKeyOf(item: CatalogItemResponse): TradeKey {
  return item.customTradeId ? customTradeKey(item.customTradeId) : (item.trade ?? 'OTHER');
}

/**
 * Group a catalog into TRADE → CATEGORY → position, the tree the master asked for after seeing
 * two trades' folders in one flat list: «якщо вибрати декілька трейдів, то не зрозуміло яка
 * категорія до чого відноситься».
 *
 * <p>Nothing here reorders anything. Folders inside a branch come out in
 * {@link catalogSectionRank} order — the library's own sequence, i.e. the order the work is
 * done in — and the branches themselves in the order their first folder already had, so a tree
 * built over a flat list shows the same rows in the same sequence, only with the trade said out
 * loud. Custom trades and folders the library ships nothing for have no rank and go last.</p>
 *
 * <p><b>A shared position appears under EVERY trade that ships it</b>, in that trade's own
 * category. `catalog_items` has one row per (name, type, unit), so a position two of the
 * master's trades both use is stored once under whichever claimed it first — showing it only
 * there is what made him ask «що тут робить категорія Шпалери?» on the drywall screen, and
 * hiding it from the other branch would be worse: he would not find a priced position where he
 * goes looking for it. This replaced the old one-trade-at-a-time re-filing, which could only ever
 * answer for a single chip. The row keeps its id, so ticking either copy ticks the position once.</p>
 *
 * <p><b>Bounded by the trades the catalog actually uses.</b> `sharedTrades` names every trade the
 * LIBRARY ships the name under, not the master's — a drywaller owns «Установка люка-ревізії
 * простого» because V120 copied it into a drywall phase, and a whole «Сантехніка» branch holding
 * that one row would be a trade he does not do. A foreign trade earns a branch only when some row
 * is stored under it.</p>
 */
export function toTradeTree(items: readonly CatalogItemResponse[]): TradeBranch[] {
  const stored = new Set<TradeKey>();
  for (const item of items) stored.add(tradeKeyOf(item));

  const rows = new Map<TradeKey, CatalogItemResponse[]>();
  const push = (key: TradeKey, item: CatalogItemResponse) => {
    const list = rows.get(key);
    if (list) list.push(item);
    else rows.set(key, [item]);
  };

  for (const item of items) {
    const own = tradeKeyOf(item);
    push(own, item);
    // A custom trade never lends its rows to a system branch: its `trade` column reads OTHER for
    // storage reasons only, and `sharedTrades` is computed off the NAME, so a system trade that
    // happens to ship the same wording would swallow a position the master filed himself.
    if (item.customTradeId) continue;
    for (const shared of item.sharedTrades ?? []) {
      if (shared.trade === own || !stored.has(shared.trade)) continue;
      // No category on the other side means that trade files it nowhere in particular — keep the
      // stored one rather than inventing «Без категорії».
      push(shared.trade, shared.category == null
        ? item
        : { ...item, category: shared.category, categoryOrder: shared.categoryOrder });
    }
  }

  return [...rows.entries()]
    .map(([key, list]) => ({
      key,
      customName: list.find((i) => i.customTradeId)?.customTradeName ?? null,
      sections: toSections(list, catalogSectionRank),
      count: list.length,
      rank: Math.min(...list.map(catalogSectionRank)),
    }))
    .sort((a, b) => a.rank - b.rank
      || systemIndex(a.key) - systemIndex(b.key)
      || (a.customName ?? '').localeCompare(b.customName ?? '', 'uk'))
    .map(({ key, customName, sections, count }) => ({ key, customName, sections, count }));
}

/** Where a system trade sits in the library's own trade order; custom trades sort after them all. */
function systemIndex(key: TradeKey): number {
  const at = (TRADE_VALUES as readonly string[]).indexOf(key);
  return at < 0 ? TRADE_VALUES.length : at;
}
