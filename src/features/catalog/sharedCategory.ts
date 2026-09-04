import type { CatalogItemResponse } from '@/api/types.ts';

/**
 * Section order for the catalog: the library's own sequence for the trade the row is being viewed
 * as, folders the library ships nothing for last.
 *
 * <p>`sortOrder` cannot do this job. It is ONE global rank, taken from the trade the row is STORED
 * under, and a section opens where its first row appears — so a single re-filed row can drag a
 * whole phase to the front. That is exactly what happened: one plumbing row («Установка
 * люка-ревізії простого», copied into drywall's «Каркас і обшивка» by backend V120) outranked every
 * drywall row, so the drywall board opened on the framing phase instead of the preparation one
 * («ми ж казали це сортувати по порядку виконання робіт»). Inside a section `sortOrder` still
 * rules, so a position the master typed himself stays where he put it.
 *
 * <p>This file used to also hold `asSelectedTradeSees`, which re-filed a shared row into the
 * category of the ONE selected trade chip. The trees replaced it: a shared position now appears
 * under EVERY trade that ships it, each time in that trade's own category and with that trade's
 * rank (see `toTradeTree`), so there is no single selection left for it to answer for.</p>
 */
export function catalogSectionRank(item: CatalogItemResponse): number {
  return item.categoryOrder ?? Number.MAX_SAFE_INTEGER;
}
