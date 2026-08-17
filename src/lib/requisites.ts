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
 * A customer's tax-id length rule depends on their type: a ФОП carries a 10-digit РНОКПП, a
 * COMPANY an 8-digit ЄДРПОУ. PERSON has no tax id, so never warns.
 */
export function clientTaxIdWarning(value: string, clientType: 'PERSON' | 'FOP' | 'COMPANY'): string | null {
  if (clientType === 'FOP') return rnokppWarning(value);
  if (clientType === 'COMPANY') return edrpouWarning(value);
  return null;
}
