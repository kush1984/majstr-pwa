import type { CrewMarginResponse, EstimateItemResponse, EstimateResponse } from '@/api/types.ts';
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
 * sums over signed ACT lines, which the editor does not hold.</p>
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
 * quantity; a line with no crew price is left exactly as it is, which is what makes its contribution
 * to the margin zero.
 */
function asCrew(item: EstimateItemResponse): EstimateItemResponse {
  if (item.sourceUnitPrice == null) return item;
  return item.unit === 'PERCENT'
    ? { ...item, quantity: item.sourceUnitPrice }
    : { ...item, unitPrice: item.sourceUnitPrice };
}

const total = (items: EstimateItemResponse[]) => items.reduce((s, i) => s + i.lineTotal, 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
