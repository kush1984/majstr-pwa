/**
 * «Може, ivan@gmail.com?» — a typo in the part after the @ caught before the form is sent. The backend
 * refuses a domain no mail reaches (gmal.com, gmail.con), and an address that slipped past it would
 * never see its verification letter, so the cheapest fix is the one offered while the person is still
 * on the field.
 *
 * Only a suggestion, and only one letter away: a real domain one letter from a popular one (mail.com
 * next to gmail.com) is in KNOWN, so it is never «corrected», and anything else the person can ignore.
 */

/** Most used first: on a tie the more likely one wins. */
const POPULAR = [
  'gmail.com', 'ukr.net', 'i.ua', 'meta.ua', 'icloud.com', 'outlook.com', 'hotmail.com', 'yahoo.com',
  'bigmir.net', 'email.ua', 'online.ua', 'proton.me', 'live.com',
];

/** Real domains that sit next to a popular one and must be left as typed. */
const KNOWN = new Set([
  ...POPULAR, 'mail.com', 'gmx.com', 'gmx.net', 'ua.fm', 'me.com', 'aol.com', 'zoho.com', 'protonmail.com',
  'googlemail.com', 'yahoo.co.uk', 'web.de', 'wp.pl', 'pm.me', 'duck.com',
]);

export function suggestEmail(email: string): string | null {
  const value = email.trim();
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return null;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1).toLowerCase();
  if (KNOWN.has(domain)) return null;

  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of POPULAR) {
    const distance = editDistance(domain, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  // ONE edit: a missing, extra, wrong or swapped letter. At two, a real domain is already someone else's
  // (yopmail.com is two letters from hotmail.com), and the suggestion would hand the person a stranger's box.
  return best !== null && bestDistance <= 1 ? `${local}@${best}` : null;
}

/** Edits between two strings, a swap of neighbours counting as one (gmial → gmail). */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (__, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, d[i - 2][j - 2] + 1);
      }
      d[i][j] = value;
    }
  }
  return d[a.length][b.length];
}
