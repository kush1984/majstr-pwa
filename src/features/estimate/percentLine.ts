import i18n from '@/lib/i18n.ts';
import { formatMoney } from '@/lib/format.ts';
import type { EstimateItemResponse } from '@/api/types.ts';

/**
 * How a «%» line reads on screen, in the PDF and on the client's portal — one wording, three places.
 *
 * <p>It used to read «10 % · 500 ₴/%»: five hundred hryvnia for one percent, which is not a thing.
 * A percentage is a share OF something, and the row has to say of what — otherwise the figure looks
 * taken from thin air, and the client is the one being asked to sign it.</p>
 *
 * <p>Returns null for an ordinary line, which keeps the caller's «ціна/од.» branch untouched.</p>
 */
export function percentLabel(
  item: EstimateItemResponse,
  byId: Map<string, EstimateItemResponse>,
): string | null {
  if (item.unit !== 'PERCENT') return null;
  // A frozen line (copied into a consolidated rollup) carries its own provenance snapshot —
  // show that verbatim instead of the generic MANUAL wording («% від {reconstructed sum}»),
  // which reads as a percentage of a number nobody can place.
  if (item.baseOriginLabel) return item.baseOriginLabel;
  const t = i18n.t.bind(i18n);
  const kind = item.percentBaseKind ?? 'MANUAL';

  if (kind === 'TOTAL') return t('estimate.percentOfTotal');
  if (kind === 'MANUAL') return t('estimate.percentOfSum', { sum: formatMoney(item.unitPrice) });

  // Added from the catalog and not set yet: the base is chosen in the estimate, never in the catalog.
  if (isPercentUnset(item)) return t('estimate.percentChooseBase');
  const bases = baseIdsOf(item).map((id) => byId.get(id));
  // A base is gone: say so instead of showing a percentage of less. The amount itself stays — the
  // master is charging for this work, and the row keeps its last computed figure.
  if (bases.length === 0 || bases.some((b) => b === undefined)) return t('estimate.percentBaseGone');
  // Several bases are named one by one (owner ruling 2026-11-23): the client sees what it is OF.
  return t('estimate.percentOfItem', { name: bases.map((b) => b!.name).join(t('estimate.percentNamesJoin')) });
}

/**
 * The lines a «% від позицій» is measured against (V221: several, summed). A row cached before V221
 * carries only `percentBaseItemId`; both read the same here.
 */
export function baseIdsOf(item: Pick<EstimateItemResponse, 'percentBaseItemId' | 'percentBaseItemIds'>): string[] {
  if (item.percentBaseItemIds && item.percentBaseItemIds.length > 0) return item.percentBaseItemIds;
  return item.percentBaseItemId ? [item.percentBaseItemId] : [];
}

/**
 * A «%» line that is not finished: no percentage typed, or no base chosen (how a «%» position arrives
 * from the catalog). It reads 0 ₴, so the send asks about it like a line with no quantity.
 */
export function isPercentUnset(item: EstimateItemResponse): boolean {
  if (item.unit !== 'PERCENT' || item.baseOriginLabel) return false;
  if (Number(item.quantity) === 0) return true;
  // No base and nothing computed. The server marks any base-less POSITION line detached on save, so
  // the flag cannot tell «never chosen» from «base deleted»; the amount can — a line whose base was
  // deleted keeps the figure it is charging for, and reads «база видалена» instead.
  return item.percentBaseKind === 'POSITION' && baseIdsOf(item).length === 0 && Number(item.lineTotal) === 0;
}
