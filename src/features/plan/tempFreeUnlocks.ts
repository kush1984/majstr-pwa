/**
 * TEMPORARY business decision — revert by deleting this file and flipping the flag back out at its
 * four call sites (grep {@link TEMP_FREE_GETS_MEASUREMENTS_AND_ECONOMY}: `MeasurementsSection.tsx`,
 * `ItemForm.tsx`'s «Вибрати з замірів» picker, `ObjectEconomySection.tsx`, and `LandingPage.tsx`'s
 * feature PRO badges — the landing shows Заміри/Економіка as free while this is true, PRO when not).
 *
 * Заміри + Економіка об'єкту opened up to FREE while the AI-calling flows (plan/sketch recognition,
 * project import — see `AI_MEASUREMENT_IMPORT_ENABLED` in `MeasurementsSection.tsx`) are hidden to
 * cut AI spend — gives FREE masters more value while those are unavailable. Safe to do: neither
 * Заміри nor Економіка calls an LLM, so this doesn't reintroduce the AI cost that was just cut.
 */
export const TEMP_FREE_GETS_MEASUREMENTS_AND_ECONOMY = true;
