/**
 * A phone as a master types it: «067 123 45 67», «+380671234567», «380-67-123-45-67». A callback lead
 * with a wrong digit is a lost client (review), so the call card checks it; the document sheet only
 * warns — a foreign number (+48 …) is a real case on a building site.
 */

/** «+380XXXXXXXXX» for a Ukrainian mobile/landline number in any usual spelling, else `null`. */
export function normalizeUaPhone(raw: string): string | null {
  const digits = raw.replace(/[\s()\-.]/g, '');
  if (/^\+380\d{9}$/.test(digits)) return digits;
  if (/^380\d{9}$/.test(digits)) return `+${digits}`;
  if (/^0\d{9}$/.test(digits)) return `+38${digits}`;
  return null;
}

/** An international number written with its «+» and 9–14 digits after it (+48 …, +49 …). */
function isInternational(raw: string): boolean {
  return /^\+\d{9,14}$/.test(raw.replace(/[\s()\-.]/g, ''));
}

/** A number we can actually call: Ukrainian in any usual form, or international with its «+». */
export function isCallablePhone(raw: string): boolean {
  return normalizeUaPhone(raw) !== null || isInternational(raw);
}
