import { describe, it, expect } from 'vitest';
import { rnokppWarning, edrpouWarning, vatIdWarning, clientTaxIdWarning } from './requisites.ts';

describe('requisite warnings (non-blocking)', () => {
  it('РНОКПП warns only when present and not 10 digits', () => {
    expect(rnokppWarning('')).toBeNull();
    expect(rnokppWarning('1234567890')).toBeNull();
    expect(rnokppWarning('12345')).toBe('requisites.warnRnokpp');
    // Grouping/spaces are ignored — only the digit count matters.
    expect(rnokppWarning('12 34 56 78 90')).toBeNull();
  });

  it('ЄДРПОУ warns only when present and not 8 digits', () => {
    expect(edrpouWarning('')).toBeNull();
    expect(edrpouWarning('12345678')).toBeNull();
    expect(edrpouWarning('123')).toBe('requisites.warnEdrpou');
  });

  it('ІПН платника ПДВ warns only when present and not 12 digits — a DIFFERENT number from РНОКПП', () => {
    expect(vatIdWarning('')).toBeNull();
    expect(vatIdWarning('123456789012')).toBeNull();
    expect(vatIdWarning('1234567890')).toBe('requisites.warnVatId'); // a 10-digit РНОКПП is wrong here
  });

  it('client tax-id rule follows the client type', () => {
    expect(clientTaxIdWarning('1234567890', 'FOP')).toBeNull();   // 10 → ok
    expect(clientTaxIdWarning('1234567890', 'COMPANY')).toBe('requisites.warnEdrpou'); // needs 8
    expect(clientTaxIdWarning('12345678', 'COMPANY')).toBeNull(); // 8 → ok
    expect(clientTaxIdWarning('anything', 'PERSON')).toBeNull();  // person has no tax id
  });
});
