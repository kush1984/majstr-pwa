/**
 * "1 234,5" / "1234.5" → 1234.5 (up to 3 decimals, matching backend quantity).
 *
 * Its own module with no imports, so the static calculator pages (src/seo/) can parse a number
 * exactly as the app does without pulling zod and i18n into a page that must load instantly.
 * `decimal.ts` re-exports it — every existing import keeps working.
 */
export function parseDecimal(s: string): number {
  return Math.round(Number(s.replace(',', '.').replace(/\s/g, '')) * 1000) / 1000;
}
