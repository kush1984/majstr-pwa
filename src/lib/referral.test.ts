import { describe, it, expect, beforeEach } from 'vitest';
import {
  captureRefFromUrl, storeRef, getStoredRef, captureUtmFromUrl, getStoredUtm, captureFirstTouch, getStoredFirstTouch,
} from './referral.ts';

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

/**
 * V178: Google sets no UTM, so the referrer HOST and the first PATH are what tell a search visitor
 * apart from one who typed the address. Recorded once, on whichever page came first.
 */
describe('first-touch referrer host and entry page', () => {
  beforeEach(() => localStorage.clear());

  it('keeps only the host of an outside referrer, and the path without its query', () => {
    captureFirstTouch('https://www.google.com/', '/kalkulyator-plytky', 'majstr.pro');
    expect(getStoredFirstTouch()).toEqual({ referrerHost: 'google.com', entryPath: '/kalkulyator-plytky' });
  });

  it('the first visit wins, even one with no referrer', () => {
    captureFirstTouch('', '/', 'majstr.pro');
    captureFirstTouch('https://www.google.com/', '/kalkulyator-styazhky', 'majstr.pro');
    expect(getStoredFirstTouch()).toEqual({ referrerHost: undefined, entryPath: '/' });
  });

  it('our own pages are not a referrer', () => {
    captureFirstTouch('https://majstr.pro/kalkulyator-plytky', '/register', 'majstr.pro');
    expect(getStoredFirstTouch().referrerHost).toBeUndefined();
    localStorage.clear();
    captureFirstTouch('https://api.majstr.pro/portal/', '/', 'majstr.pro');
    expect(getStoredFirstTouch().referrerHost).toBeUndefined();
  });

  it('a malformed referrer records nothing rather than throwing', () => {
    expect(() => captureFirstTouch('not a url', '/', 'majstr.pro')).not.toThrow();
  });
});

/** The calculator pages are separate documents: without their own capture a search visitor who
 *  lands there and follows the CTA to /register would carry no source at all. */
describe('the calculator pages record the first touch too', () => {
  it('calcPage.ts captures ref, UTM and the referrer on load', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(process.cwd(), 'src/seo/calcPage.ts'), 'utf8');
    expect(source).toContain('captureRefFromUrl(window.location.search);');
    expect(source).toContain('captureUtmFromUrl(window.location.search);');
    expect(source).toContain('captureFirstTouch(document.referrer, window.location.pathname, window.location.hostname);');
  });
});
