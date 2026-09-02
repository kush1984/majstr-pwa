import type { CatalogItemResponse } from '@/api/types.ts';
import { parseCustomTradeKey, type TradeKey } from './TradeFilterChips.tsx';

/**
 * Re-files the rows a trade chip only sees through `sharedTrades` into the category THAT trade
 * keeps them in.
 *
 * <p>A master's catalog has one row per (name, type, unit) — the backend's unique index has no
 * room for a second — so a position two of his trades both ship under identical wording is stored
 * once, tagged whichever trade claimed it first, in that trade's category. Backend V116 copied ten
 * painter/demolition positions verbatim into drywall phases, so his drywall chip was showing
 * «Шпалери», «Шпаклювання та шліфування» and «Звукоізоляція» folders — painter categories, on a
 * drywall screen: «що тут робить категорія Шпалери?».
 *
 * <p>This is deliberately a DISPLAY-time change and not a re-file: the row is equally correct in
 * both places, and moving it would only put the same foreign folder on the painter chip instead.
 * It applies only while exactly ONE system trade is selected — with no filter (or several trades)
 * there is no single answer to «whose category?», and the stored one is the honest default.
 *
 * <p>It re-files the row's `categoryOrder` along with its category, which is what puts the FOLDERS
 * in the order the selected trade does the work in — see {@link catalogSectionRank}.
 */
export function asSelectedTradeSees(
  items: readonly CatalogItemResponse[],
  selected: ReadonlySet<TradeKey>,
): CatalogItemResponse[] {
  if (selected.size !== 1) return items as CatalogItemResponse[];
  const [key] = [...selected];
  if (parseCustomTradeKey(key) !== null) return items as CatalogItemResponse[];

  return items.map((item) => {
    if ((item.trade ?? 'OTHER') === key) return item;
    const shared = item.sharedTrades?.find((s) => s.trade === key);
    if (shared?.category == null) return item;
    // The rank travels with the category even when the two trades happen to NAME the folder the
    // same way — they still sequence it differently, and the stored trade's rank would sort this
    // row (and so its whole folder) somewhere that trade's order has nothing to say about.
    if (shared.category === item.category && shared.categoryOrder === item.categoryOrder) return item;
    return { ...item, category: shared.category, categoryOrder: shared.categoryOrder };
  });
}

/**
 * Section order for the catalog: the library's own sequence for the trade the row is being viewed
 * as, folders the library ships nothing for last.
 *
 * <p>`sortOrder` cannot do this job. It is ONE global rank, taken from the trade the row is STORED
 * under, and a section opens where its first row appears — so a single re-filed row can drag a
 * whole phase to the front. That is exactly what happened: one plumbing row («Установка
 * люка-ревізії простого», copied into drywall's «Каркас і обшивка» by backend V120) outranked every
 * drywall row, so the drywall chip opened on the framing phase instead of the preparation one
 * («ми ж казали це сортувати по порядку виконання робіт»). Inside a section `sortOrder` still
 * rules, so a position the master typed himself stays where he put it.
 */
export function catalogSectionRank(item: CatalogItemResponse): number {
  return item.categoryOrder ?? Number.MAX_SAFE_INTEGER;
}
