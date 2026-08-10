import { describe, it, expect } from 'vitest';
import { resolveTab } from './ProjectDetailPage.tsx';

describe('resolveTab — the ?tab= URL param drives the active object tab', () => {
  it('reads a known tab straight off the param', () => {
    expect(resolveTab('act')).toBe('act');
    expect(resolveTab('measurements')).toBe('measurements');
  });

  it('defaults to «Кошторис» when the param is absent — direct entry, unchanged', () => {
    expect(resolveTab(null)).toBe('estimate');
  });

  it('falls back to «Кошторис» for anything unrecognized, rather than crashing or leaking a bad value', () => {
    expect(resolveTab('nonsense')).toBe('estimate');
    expect(resolveTab('')).toBe('estimate');
  });
});
