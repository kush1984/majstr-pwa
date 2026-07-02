import { describe, it, expect, beforeEach } from 'vitest';
import { captureRefFromUrl, storeRef, getStoredRef } from './referral.ts';

beforeEach(() => localStorage.clear());

describe('referral first-touch capture', () => {
  it('captures ?ref= from the URL', () => {
    captureRefFromUrl('?ref=liga');
    expect(getStoredRef()).toBe('liga');
  });

  it('first-touch: a later ref never overwrites the stored one', () => {
    storeRef('liga');
    captureRefFromUrl('?ref=other');
    storeRef('another');
    expect(getStoredRef()).toBe('liga');
  });

  it('no ref in the URL → nothing stored', () => {
    captureRefFromUrl('?foo=bar');
    expect(getStoredRef()).toBeUndefined();
  });

  it('trims whitespace and caps length', () => {
    storeRef('  LIGA  ');
    expect(getStoredRef()).toBe('LIGA');
  });
});
