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
  /** Positions in THIS branch. */
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
 * <p><b>Every row sits in its own trade's branch.</b> Since backend V220 a position two of the
 * master's trades both ship is a row in EACH trade, in that trade's own folder and at its own
 * price — so nothing is re-filed here, and an electrician never sees a tiling folder.</p>
 */
export function toTradeTree(items: readonly CatalogItemResponse[]): TradeBranch[] {
  const rows = new Map<TradeKey, CatalogItemResponse[]>();
  for (const item of items) {
    const key = tradeKeyOf(item);
    const list = rows.get(key);
    if (list) list.push(item);
    else rows.set(key, [item]);
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
