import { describe, it, expect, beforeEach } from 'vitest';
import { captureRefFromUrl, storeRef, getStoredRef, captureUtmFromUrl, getStoredUtm } from './referral.ts';

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

describe('UTM first-touch capture', () => {
  it('captures the three tags from the entry URL', () => {
    captureUtmFromUrl('?utm_source=tiktok&utm_medium=video&utm_campaign=aug26');
    expect(getStoredUtm()).toEqual({ utmSource: 'tiktok', utmMedium: 'video', utmCampaign: 'aug26' });
  });

  it('first-touch: a later campaign never overwrites the stored one', () => {
    captureUtmFromUrl('?utm_source=tiktok');
    captureUtmFromUrl('?utm_source=telegram&utm_campaign=sep26');
    // Not a merge either — a medium from one campaign glued onto another campaign's source
    // would describe a visit that never happened.
    expect(getStoredUtm().utmSource).toBe('tiktok');
    expect(getStoredUtm().utmCampaign).toBeUndefined();
  });

  it('no tags in the URL → nothing stored, so tomorrow\u2019s campaign link still counts', () => {
    captureUtmFromUrl('?ref=liga');
    expect(getStoredUtm()).toEqual({});
    captureUtmFromUrl('?utm_source=telegram');
    expect(getStoredUtm().utmSource).toBe('telegram');
  });

  it('a partner ref and a UTM tag coexist — they are different dimensions', () => {
    captureRefFromUrl('?ref=liga&utm_source=tiktok');
    captureUtmFromUrl('?ref=liga&utm_source=tiktok');
    expect(getStoredRef()).toBe('liga');
    expect(getStoredUtm().utmSource).toBe('tiktok');
  });
});
