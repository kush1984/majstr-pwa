import { z } from 'zod';
import i18n from '@/lib/i18n.ts';

/** "1 234,5" / "1234.5" → 1234.5 (up to 3 decimals, matching backend quantity). */
export function parseDecimal(s: string): number {
  return Math.round(Number(s.replace(',', '.').replace(/\s/g, '')) * 1000) / 1000;
}

/**
 * Round to the scale money is STORED at, HALF_UP away from zero — the server's `MONEY_SCALE`.
 *
 * The detour through strings is not decoration. `Math.round(n * 100) / 100` ties toward +∞ (so a
 * negative «%» line disagrees with the server on 5,89 % of cases) and carries the multiplication's
 * own float error into the decision; `toPrecision(15)` drops the error, and `'e2'`/`'e-2'` move the
 * point without ever multiplying. Brute-forced against the server over 658 364 cases: 0 mismatches.
 */
export function roundMoney(n: number): number {
  const a = Math.abs(Number(n.toPrecision(15)));
  // Below half a kopeck the answer is 0 either way — and JS writes such numbers in exponent form,
  // which the string trick below would turn into NaN.
  if (a < 0.005) return 0;
  const r = Number(Math.round(Number(a + 'e2')) + 'e-2');
  return n < 0 ? -r : r;
}

/**
 * Add money in KOPECKS — 0.1 + 0.2 is 0.30000000000000004, and a total is a long chain of those.
 * Each term is rounded first, exactly as the server rounds each stored line before summing.
 */
export function sumMoney(values: number[]): number {
  return values.reduce((kop, v) => kop + Math.round(roundMoney(v) * 100), 0) / 100;
}

/**
 * Apply a ±% to one price — the mirror of `EstimateService.markedUp` (review B-47).
 *
 * Rounding to the whole hryvnia looked tidy on a 850 ₴ position and was a catastrophe on a cheap
 * one bought by the thousand: 0,40 ₴ +20 % came out at 0,00, so 2 000 pcs were billed nothing at
 * all. The floor is the second half — a position that costs money may never come out free, which
 * a deep discount can otherwise produce even at scale 2.
 *
 * Mirrored pair: change this and `EstimateService.markedUp` in the same commit.
 */
export function markedUpPrice(price: number, factor: number): number {
  const marked = roundMoney(price * factor);
  return price > 0 && marked <= 0 ? 0.01 : marked;
}

/**
 * Read a money field the master typed — or answer `null`, which is the whole point (review P-35).
 *
 * The old helper was `Number(s.replace(',', '.'))` with a `0` fallback, so «1 200», «12а», «−5» and
 * «1.200,50» all became <b>0 ₴</b> in silence: an additional-work price turned into a free line on a
 * signed act, an advance into nothing, a quantity into a position that vanished. A figure nobody
 * typed may never reach a document, so an unreadable field says so and blocks Save instead.
 *
 * Accepts «1 200», «1 200,50», «12,5» (space, thin space and apostrophe are grouping, not data);
 * refuses «0,004», «12.345», «1.200,50», «−5», «1e5», «0x10», «Infinity» and 100 000 000.
 */
export function parseMoney(
  raw: string,
  { max = 99_999_999.99, allowZero = false }: { max?: number; allowZero?: boolean } = {},
): number | null {
  const s = raw.trim().replace(/[\s\u00a0\u202f']/g, '');
  if (!/^\d{1,11}([.,]\d{1,2})?$/.test(s)) return null;
  const n = Number(s.replace(',', '.'));
  return (allowZero ? n >= 0 : n >= 0.01) && n <= max ? n : null;
}

/**
 * The same door for a quantity: 3 decimals, matching the server's `QUANTITY_SCALE`, and `null`
 * rather than a 0 that silently drops the line out of the act.
 */
export function parseQuantity(
  raw: string,
  { max = 9_999_999.999, allowZero = false }: { max?: number; allowZero?: boolean } = {},
): number | null {
  const s = raw.trim().replace(/[\s\u00a0\u202f']/g, '');
  if (!/^\d{1,10}([.,]\d{1,3})?$/.test(s)) return null;
  const n = Number(s.replace(',', '.'));
  return (allowZero ? n >= 0 : n >= 0.001) && n <= max ? n : null;
}

/**
 * Zod string field that must parse to a positive quantity (comma or dot, spaces allowed).
 *
 * Goes through `parseQuantity` (review P-35) so the form and everything downstream agree on what a
 * number is: bare `Number` accepted `1e3` and a fourth decimal the server then rounded away.
 */
export function decimalString(emptyMessage: string) {
  return z
    .string()
    .min(1, emptyMessage)
    .refine((s) => parseQuantity(s) !== null, i18n.t('validation.badQuantity'));
}
