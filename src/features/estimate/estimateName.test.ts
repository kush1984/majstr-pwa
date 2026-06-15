import { describe, it, expect } from 'vitest';
import { estimateName } from './estimateName.ts';

describe('estimateName', () => {
  const iso = '2026-06-12T10:00:00Z';

  it('returns the trimmed contractor name when set', () => {
    expect(estimateName('  Преміум  ', iso)).toBe('Преміум');
    expect(estimateName('Економ', iso)).toBe('Економ');
  });

  it('falls back to a dated default when name is blank or null', () => {
    // distinguishes unnamed variants by date (uk default: "Кошторис від …")
    expect(estimateName(null, iso)).toContain('Кошторис від');
    expect(estimateName('   ', iso)).toContain('Кошторис від');
    expect(estimateName(undefined, iso)).toContain('Кошторис від');
  });
});
