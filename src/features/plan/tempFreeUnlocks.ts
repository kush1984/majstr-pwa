/**
 * TEMPORARY business decision — revert by deleting this file and flipping the flag back out at its
 * four call sites (grep {@link TEMP_FREE_GETS_MEASUREMENTS_AND_ECONOMY}: `MeasurementsSection.tsx`,
 * `ItemForm.tsx`'s «Вибрати з замірів» picker, `ObjectEconomySection.tsx`, and `LandingPage.tsx`'s
 * feature PRO badges — the landing shows Заміри/Економіка as free while this is true, PRO when not).
 *
 * Заміри + Економіка об'єкту opened up to FREE while the AI-calling flows (plan/sketch recognition,
 * project import — see `SKETCH_IMPORT_ENABLED` / `PROJECT_IMPORT_ENABLED` in `MeasurementsSection.tsx`) are gated or hidden to
 * cut AI spend — gives FREE masters more value while those are unavailable. Safe to do: neither
 * Заміри nor Економіка calls an LLM, so this doesn't reintroduce the AI cost that was just cut.
 */
export const TEMP_FREE_GETS_MEASUREMENTS_AND_ECONOMY = true;

/**
 * TEMPORARY too (master decision, 2026-11-11) — mirrors `Feature.RECEIPT_IMPORT` in the backend's
 * FREE plan (`PlanConfig`); flip both together. The estimate's «Додати з чеку» reads a receipt with
 * no QR by AI on FREE, as the object and act receipts already do. When this goes back to false,
 * `ReceiptImportSheet` says «на чеку немає QR-коду — це в Pro» again instead of reading the photo.
 */
export const TEMP_FREE_GETS_RECEIPT_IMPORT = true;
