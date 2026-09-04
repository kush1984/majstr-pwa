import type { EstimateTemplateSummary } from '@/api/types.ts';
import { TRADE_VALUES } from '@/features/auth/registerSchema.ts';
import { customTradeKey, type TradeKey } from '@/features/catalog/tradeKey.ts';

/** One trade and the bundles filed under it. */
export interface TemplateBranch {
  key: TradeKey;
  /** The master's own name for a `custom:<id>` trade; null for a system one, whose label the
   *  caller translates from the key (the tree stays free of i18n). */
  customName: string | null;
  templates: EstimateTemplateSummary[];
}

/** Which trade a bundle is filed under. A custom-trade row reads OTHER underneath (V91), so the
 *  custom id has to win — and templates use GENERAL, not OTHER, for «no particular trade». */
export function templateTradeKey(tpl: EstimateTemplateSummary): TradeKey {
  return tpl.customTradeId ? customTradeKey(tpl.customTradeId) : (tpl.trade ?? 'GENERAL');
}

/**
 * Group templates into TRADE → bundle, the same tree the catalog picker got one round earlier and
 * for the same reason: a trade chip ANSWERS «покажи мені тільки це», which is the opposite of what
 * a master composing one estimate needs — «з можливістю вибирати шаблони з різних трейдів для
 * одного кошторису». A filter hides the other trades, so a selection spanning two of them was
 * invisible while it was being made; a tree shows every trade at once and lets the ticks
 * accumulate in plain sight.
 *
 * <p>Bundles keep the order the server sent them in — there is no `sort_order` on a template, and
 * within one trade the list is short. The BRANCHES come out in the library's own trade order
 * ({@link TRADE_VALUES}, the sequence V118 ranks the catalog by), so the picker and the catalog
 * name the trades in the same sequence. Custom trades have no place in that order and sort after
 * every system one, by name.</p>
 *
 * <p>Unlike the catalog's tree there is no sharing to resolve: a template belongs to exactly one
 * trade, so every bundle appears in exactly one branch and the flat list and the tree hold the
 * same rows.</p>
 */
export function toTemplateTree(templates: readonly EstimateTemplateSummary[]): TemplateBranch[] {
  const branches = new Map<TradeKey, EstimateTemplateSummary[]>();
  for (const tpl of templates) {
    const key = templateTradeKey(tpl);
    const list = branches.get(key);
    if (list) list.push(tpl);
    else branches.set(key, [tpl]);
  }

  return [...branches.entries()]
    .map(([key, list]) => ({
      key,
      customName: list.find((tpl) => tpl.customTradeId)?.customTradeName ?? null,
      templates: list,
    }))
    .sort(
      (a, b) =>
        systemIndex(a.key) - systemIndex(b.key) ||
        (a.customName ?? '').localeCompare(b.customName ?? '', 'uk'),
    );
}

/** Where a system trade sits in the library's own trade order; custom trades sort after them all. */
function systemIndex(key: TradeKey): number {
  const at = (TRADE_VALUES as readonly string[]).indexOf(key);
  return at < 0 ? TRADE_VALUES.length : at;
}
