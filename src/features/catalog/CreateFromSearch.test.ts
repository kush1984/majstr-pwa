import { describe, it, expect } from 'vitest';
import { nameKey, shouldOfferCreate } from './CreateFromSearch.tsx';

describe('shouldOfferCreate', () => {
  const names = ['Укладання плитки 300х300', 'Ґрунтування поверхні'];

  it('offers a name the catalog does not have', () => {
    expect(shouldOfferCreate('Плитка на фартух', names)).toBe(true);
    // Similar positions exist, but not this one — the case it is for.
    expect(shouldOfferCreate('Укладання плитки', names)).toBe(true);
  });

  it('never offers a name that is already there, whatever its case or spacing', () => {
    expect(shouldOfferCreate('  укладання   ПЛИТКИ 300х300 ', names)).toBe(false);
  });

  it('waits for more than one letter', () => {
    expect(shouldOfferCreate('п', names)).toBe(false);
    expect(shouldOfferCreate('   ', names)).toBe(false);
  });

  it('compares by one key', () => {
    expect(nameKey('  Фарбування \t стін ')).toBe('фарбування стін');
  });
});
