import type { CrewMarginResponse, EstimateItemResponse, EstimateResponse } from '@/api/types.ts';
import { roundMoney, sumMoney } from '@/lib/decimal.ts';
import { recomputeLines } from './useEstimate.ts';

/**
 * «Бригаді / Твоя націнка» recomputed on the device — the mirror of the backend's
 * `CrewMarginCalculator`, and it must be changed in the same commit as that file.
 *
 * <p><b>Why a mirror at all.</b> The editor is offline-first: a master raises a price in a flat with
 * no signal and the figure under the total has to move with it. Waiting for the server would mean
 * showing him the margin of the estimate he had five edits ago.</p>
 *
 * <p><b>Eligibility stays the SERVER's call.</b> The response's `crewMargin` is the signal that this
 * estimate is a markup copy at all — nothing here re-derives that, because the PWA is never told the
 * estimate's `markupPercent`. So: no server figure, no local one either; with one, the arithmetic is
 * redone over whatever the lines say NOW.</p>
 *
 * <p><b>`marginAccepted` is not mirrored</b> and is carried through from the server untouched: it
 * sums over signed ACT lines and their ADJUSTMENT rows, which the editor does not hold.</p>
 *
 * <p><b>A line with no crew price is ZERO for the crew</b> (owner ruling 2026-11-23): the master
 * added it to the client's copy — a «+10 %», an extra work — and the crew never sees it, so its
 * whole amount is his margin, and a discount he added comes out of it. A «%» line is zeroed through
 * `baseDetached`, which `recomputeLines` honours on both percent passes, so it is never re-measured
 * against the crew's subtotal.</p>
 */
export function crewMarginOf(est: EstimateResponse): CrewMarginResponse | null {
  const fromServer = est.crewMargin;
  if (!fromServer) return null;

  const client = total(recomputeLines(est.items));
  const crew = total(recomputeLines(est.items.map(asCrew)));

  const unpriced = est.items.filter((i) => i.sourceUnitPrice == null);
  return {
    crewTotal: round2(crew),
    margin: round2(client - crew),
    marginAccepted: fromServer.marginAccepted,
    unpricedCount: unpriced.length,
    unpricedTotal: round2(unpriced.reduce((s, i) => s + i.lineTotal, 0)),
  };
}

/**
 * One line wearing the crew's own number. On a PERCENT line that number IS a percent (the backend
 * stores the original percent in `sourceUnitPrice` for exactly this), so it goes back into the
 * quantity; a line with no crew price was added by the master and is zero for the crew.
 */
function asCrew(item: EstimateItemResponse): EstimateItemResponse {
  if (item.sourceUnitPrice == null) {
    return item.unit === 'PERCENT'
      ? { ...item, baseDetached: true, lineTotal: 0 }
      : { ...item, unitPrice: 0, lineTotal: 0 };
  }
  return item.unit === 'PERCENT'
    ? { ...item, quantity: item.sourceUnitPrice }
    : { ...item, unitPrice: item.sourceUnitPrice };
}

const total = (items: EstimateItemResponse[]) => sumMoney(items.map((i) => i.lineTotal));
// The server's HALF_UP (review P-39) — `Math.round(n * 100) / 100` ties the other way on a
// negative figure, and a negative figure is exactly what a discount copy produces.
const round2 = roundMoney;
