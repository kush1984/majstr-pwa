/**
 * Display formatters. All money in the app is computed by the backend
 * (BigDecimal) and arrives as a JSON number; the client only formats it.
 */

// We append the ₴ glyph ourselves rather than Intl `style: 'currency'`,
// which renders "грн" in the uk-UA locale — the product wants "61 070 ₴".
const number0 = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 });
const number2 = new Intl.NumberFormat('uk-UA', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const number3 = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 3 });

/**
 * "61 070 ₴", and "12 345,50 ₴" when there ARE kopecks — ONE rule for money on screen.
 *
 * <p>It used to round to whole hryvnia everywhere, which lied in two directions at once (review
 * P-43, P-46). A unit price of 0,40 ₴ read «0 ₴/шт» and 12,50 ₴ read «13 ₴/м²» beside a «125 ₴»
 * that was exact; an estimate total showed «12 346 ₴» where the PDF the client signs says
 * 12 345,50; and the economy panel's rounded parts did not add up to its rounded sum. Hiding
 * kopecks that are not there keeps the common case short — which is why it was rounded in the
 * first place — without ever showing a figure the master cannot find on his own paper.</p>
 */
export function formatMoney(value: number | null | undefined): string {
  const n = value ?? 0;
  return `${(hasKopecks(n) ? number2 : number0).format(n)} ₴`;
}

/** Whether a figure has anything after the comma, asked at the scale money is stored in. */
function hasKopecks(value: number): boolean {
  return Math.round(value * 100) % 100 !== 0;
}

/** "61 070,00 ₴" — with kopecks, for places that need exactness. */
export function formatMoneyExact(value: number | null | undefined): string {
  return `${number2.format(value ?? 0)} ₴`;
}

/** "61 070" — the same rule without the glyph, for a row inside a list whose currency is already
 *  established by a header above it (e.g. a compact payments row). */
export function formatAmount(value: number | null | undefined): string {
  const n = value ?? 0;
  return (hasKopecks(n) ? number2 : number0).format(n);
}

/** Plain number with uk grouping, e.g. unit price "200" or quantity "18,5". */
export function formatNumber(value: number | null | undefined, fraction = 0): string {
  return (fraction > 0 ? number3 : number0).format(value ?? 0);
}

const dateFmt = new Intl.DateTimeFormat('uk-UA', {
  day: 'numeric',
  month: 'long',
});

const dateWithYearFmt = new Intl.DateTimeFormat('uk-UA', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/**
 * ISO instant/date → "18 листопада", and "18 листопада 2025 р." once it falls outside the current
 * year. Returns '' for nullish input.
 *
 * <p>The year is not decoration: «Підписано 18 листопада» on an estimate signed last November reads
 * as three weeks ago, and these dates sit on documents a master keeps for years.</p>
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return (d.getFullYear() === new Date().getFullYear() ? dateFmt : dateWithYearFmt).format(d);
}

const dateTimeFmt = new Intl.DateTimeFormat('uk-UA', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

/** ISO instant → "18 листопада, 14:30". For timestamped items like questions. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dateTimeFmt.format(d);
}

/** Two-letter initials for avatars: "Олена Петренко" → "ОП". */
export function initials(fullName: string | null | undefined): string {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('');
}
