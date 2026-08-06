import type { EstimateSummary } from '@/api/types.ts';

/**
 * The hint shown UNDER the economy checkbox on an estimate that is one half of a duplicated pair,
 * or null for an ordinary estimate.
 *
 * It is deliberately not the checkbox's own label. The label has to keep saying what the tick
 * does — put the explanation there instead and it greys out with an un-ticked box, which reads as
 * "this note applies only while the tick is on" rather than as the standing arrangement it is.
 *
 * `isCrewSource` means some other estimate on the object was duplicated FROM this one.
 */
export function economyPairHint(
  summary: Pick<EstimateSummary, 'markupPercent'>,
  isCrewSource: boolean,
): 'estimate.duplicateMarkupHint' | 'estimate.duplicateDiscountHint' | 'estimate.crewPricesHint' | null {
  // markupPercent is SIGNED: negative for a discount (уцінка). The percent shown is its magnitude.
  if (summary.markupPercent != null) {
    return summary.markupPercent < 0
      ? 'estimate.duplicateDiscountHint'
      : 'estimate.duplicateMarkupHint';
  }
  if (isCrewSource) return 'estimate.crewPricesHint';
  return null;
}
