import { describe, it, expect } from 'vitest';
import { resolveTab } from './ProjectDetailPage.tsx';

describe('resolveTab — the ?tab= URL param drives the active object tab', () => {
  it('reads a known tab straight off the param', () => {
    expect(resolveTab('economy')).toBe('economy');
    expect(resolveTab('acts')).toBe('acts');
    expect(resolveTab('measurements')).toBe('measurements');
  });

  it('maps the legacy `?tab=act` onto the renamed «Економіка» tab, not the fallback', () => {
    // `act` used to be the economy tab before the real acts tab took the name (acts iteration).
    // Old links/bookmarks are in the wild — this alias is the test that tomorrow saves them from
    // silently landing on «Кошториси».
    expect(resolveTab('act')).toBe('economy');
  });

  it('defaults to «Кошторис» when the param is absent — direct entry, unchanged', () => {
    expect(resolveTab(null)).toBe('estimate');
  });

  it('falls back to «Кошторис» for anything unrecognized, rather than crashing or leaking a bad value', () => {
    expect(resolveTab('nonsense')).toBe('estimate');
    expect(resolveTab('')).toBe('estimate');
    // «notes» was a real tab before Notes moved to the FAB — now unknown, must not resolve.
    expect(resolveTab('notes')).toBe('estimate');
  });
});
