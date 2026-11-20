/**
 * Warning-only validation for Ukrainian document requisites (acts iteration).
 *
 * These NEVER block saving — a master can store a half-filled or in-progress number and finish it
 * later. Each returns an i18n key for a yellow hint under the field, or null when the value is
 * empty or already the right length. Only a present-but-wrong-length value warns.
 *
 * ⚠️ РНОКПП (individual, 10 digits) and ІПН платника ПДВ (VAT payer, 12 digits) are DIFFERENT
 * numbers — the UI must label them distinctly, and these helpers keep their rules apart.
 */

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

/** РНОКПП (individual tax number) — 10 digits. */
export function rnokppWarning(value: string): string | null {
  const d = digits(value);
  return d.length > 0 && d.length !== 10 ? 'requisites.warnRnokpp' : null;
}

/** ЄДРПОУ (legal-entity code) — 8 digits. */
export function edrpouWarning(value: string): string | null {
  const d = digits(value);
  return d.length > 0 && d.length !== 8 ? 'requisites.warnEdrpou' : null;
}

/** ІПН платника ПДВ (VAT payer number) — 12 digits. */
export function vatIdWarning(value: string): string | null {
  const d = digits(value);
  return d.length > 0 && d.length !== 12 ? 'requisites.warnVatId' : null;
}

/**
 * Where a client pays (V217). Unlike the numbers above these are refused by the server too — a client
 * sends money to them — so the warning here only says it before the save does.
 */
export function cardWarning(value: string): string | null {
  const d = value.replace(/[\s-]/g, '');
  if (d.length === 0) return null;
  return /^\d{13,19}$/.test(d) && luhn(d) ? null : 'settings.warnCard';
}

export function linkWarning(value: string): string | null {
  const v = value.trim();
  if (v.length === 0) return null;
  try {
    const url = new URL(v);
    return url.protocol === 'https:' && url.hostname !== '' && url.username === '' ? null : 'settings.warnLink';
  } catch {
    return 'settings.warnLink';
  }
}

/** The card-number check digit — the same rule `PayoutDetails.luhn` applies on the server. */
export function luhn(d: string): boolean {
  let sum = 0;
  for (let i = d.length - 1, twice = false; i >= 0; i--, twice = !twice) {
    let n = Number(d[i]);
    if (twice) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/**
 * A customer's tax-id length rule depends on their type: a ФОП carries a 10-digit РНОКПП, a
 * COMPANY an 8-digit ЄДРПОУ. PERSON has no tax id, so never warns.
 */
export function clientTaxIdWarning(value: string, clientType: 'PERSON' | 'FOP' | 'COMPANY'): string | null {
  if (clientType === 'FOP') return rnokppWarning(value);
  if (clientType === 'COMPANY') return edrpouWarning(value);
  return null;
}
