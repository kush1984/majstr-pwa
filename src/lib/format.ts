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

/** "61 070 ₴" — whole hryvnias, the default for cards and totals. */
export function formatMoney(value: number | null | undefined): string {
  return `${number0.format(value ?? 0)} ₴`;
}

/** "61 070,00 ₴" — with kopecks, for places that need exactness. */
export function formatMoneyExact(value: number | null | undefined): string {
  return `${number2.format(value ?? 0)} ₴`;
}

/** Plain number with uk grouping, e.g. unit price "200" or quantity "18,5". */
export function formatNumber(value: number | null | undefined, fraction = 0): string {
  return (fraction > 0 ? number3 : number0).format(value ?? 0);
}

const dateFmt = new Intl.DateTimeFormat('uk-UA', {
  day: 'numeric',
  month: 'long',
});

/** ISO instant/date → "18 листопада". Returns '' for nullish input. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dateFmt.format(d);
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
