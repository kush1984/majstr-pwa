import { describe, it, expect, beforeEach } from 'vitest';
import { dropLegacyStorage } from './legacyStorage.ts';

describe('dropLegacyStorage', () => {
  beforeEach(() => localStorage.clear());

  it('removes the calculator answers an earlier build kept per estimate, and nothing else', () => {
    localStorage.setItem('materials:e1:params', '{"perimeter":12}');
    localStorage.setItem('materials:e2:params', '{}');
    localStorage.setItem('majstr.accessToken', 'keep');
    localStorage.setItem('collapsed:e1', '["a"]');

    dropLegacyStorage();

    expect(localStorage.getItem('materials:e1:params')).toBeNull();
    expect(localStorage.getItem('materials:e2:params')).toBeNull();
    expect(localStorage.getItem('majstr.accessToken')).toBe('keep');
    expect(localStorage.getItem('collapsed:e1')).toBe('["a"]');
  });
});
