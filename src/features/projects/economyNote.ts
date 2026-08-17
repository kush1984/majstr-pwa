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
): 'estimate.duplicateMarkupHint' | 'estimate.crewPricesHint' | null {
  // markupPercent is SIGNED: negative for a discount (уцінка), positive for a markup. Only the
  // markup case still has something non-obvious to say — a discount duplicate is now counted the
  // same as any other estimate (economy-rework iteration removed the "difference" computation
  // that used to make a discount duplicate's contribution go negative), so there is nothing left
  // to warn about here. What DOES need saying — a discounted duplicate superseding its
  // still-signed parent — happens at sign time and shows as a banner on the PARENT row instead
  // (ProjectDetailPage's `supersededByName`), not as a standing note on this one.
  if (summary.markupPercent != null && summary.markupPercent > 0) {
    return 'estimate.duplicateMarkupHint';
  }
  if (isCrewSource) return 'estimate.crewPricesHint';
  return null;
}

/**
 * Whether the «клієнт підписав похідний …» supersede banner should render on an estimate row.
 *
 * As of the acts iteration a superseded parent is NO LONGER auto-reopened — it keeps its
 * signature and just stops counting in the economy (surfaced on its Економіка panel). The only
 * rows still carrying a supersede flag in the Кошториси list are LEGACY drafts reopened by the
 * old behavior, and the banner's «Повернуто в чернетки» wording reads wrong on a plain draft — so
 * it's suppressed for DRAFT. A non-draft row with a name still shows it.
 */
export function shouldShowSupersedeBanner(
  status: EstimateSummary['status'],
  supersededByName: string | null,
): boolean {
  return supersededByName != null && status !== 'DRAFT';
}
