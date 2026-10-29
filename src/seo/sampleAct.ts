// The sample act on /zrazok-akta: the FINAL act for the sample estimate (sampleEstimate.ts) — every
// line of it done, one additional job found on site, and the estimate's 30 % advance offset. The extra
// position and its price are the library's own (TILING «Облицювання плиткою короба», V179). The act's
// shape — sections, «Разом за актом», «Зараховано авансів», «До сплати», the sum in words — is the
// app's act PDF (WorkActPdfService). Totals are computed, never typed.

import { SAMPLE_LINES, lineTotalKop, sampleTotalKop, type SampleLine } from './sampleEstimate.ts';

export const SAMPLE_ACT_ADDITIONAL: SampleLine[] = [
  { section: 'Додаткові роботи', name: 'Облицювання плиткою короба', unit: 'M2', quantity: 1.2, price: 900 },
];

/** The sample estimate's own terms: «Передоплата 30 % на старті». */
export const SAMPLE_ADVANCE_PERCENT = 30;

export function actWorksKop(): number {
  return sampleTotalKop(SAMPLE_LINES);
}

export function actAdditionalKop(): number {
  return SAMPLE_ACT_ADDITIONAL.reduce((sum, line) => sum + lineTotalKop(line), 0);
}

export function actGrandKop(): number {
  return actWorksKop() + actAdditionalKop();
}

/** The advance taken on the ESTIMATE, rounded to the kopeck like every money figure in the app. */
export function actAdvanceKop(): number {
  return Math.round((sampleTotalKop() * SAMPLE_ADVANCE_PERCENT) / 100);
}

/** Floored at zero, as the act PDF does. */
export function actPayableKop(): number {
  return Math.max(0, actGrandKop() - actAdvanceKop());
}
