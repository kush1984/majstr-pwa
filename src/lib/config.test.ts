import { describe, it, expect } from 'vitest';
import { replaySampleRate } from './config.ts';

describe('replaySampleRate', () => {
  it('defaults to 1 when the variable is not set at all', () => {
    expect(replaySampleRate(undefined)).toBe(1);
  });

  // The regression this file exists for: a hosting dashboard makes it trivial to create the
  // variable with no value, `Number('')` is 0, and 0 is a legal rate — so replay silently
  // recorded nothing while the SDK loaded and every event still arrived.
  it('defaults to 1 for a blank value instead of silently disabling replay', () => {
    expect(replaySampleRate('')).toBe(1);
    expect(replaySampleRate('   ')).toBe(1);
  });

  it('honours a real rate inside 0..1', () => {
    expect(replaySampleRate('0.25')).toBe(0.25);
    expect(replaySampleRate('1')).toBe(1);
  });

  // An explicit zero is someone deliberately turning replay off — that must still work.
  it('honours an explicit 0', () => {
    expect(replaySampleRate('0')).toBe(0);
  });

  it('falls back to 1 on out-of-range or unparseable values', () => {
    expect(replaySampleRate('2')).toBe(1);
    expect(replaySampleRate('-0.5')).toBe(1);
    expect(replaySampleRate('half')).toBe(1);
  });
});
