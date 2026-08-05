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
  const t = i18n.t.bind(i18n);
  const kind = item.percentBaseKind ?? 'MANUAL';

  if (kind === 'TOTAL') return t('estimate.percentOfTotal');
  if (kind === 'MANUAL') return t('estimate.percentOfSum', { sum: formatMoney(item.unitPrice) });

  const base = item.percentBaseItemId ? byId.get(item.percentBaseItemId) : undefined;
  // The base is gone: say so instead of showing a percentage of nothing. The amount itself stays —
  // the master is charging for this work, and the row keeps its last computed figure.
  return base
    ? t('estimate.percentOfItem', { name: base.name })
    : t('estimate.percentBaseGone');
}
