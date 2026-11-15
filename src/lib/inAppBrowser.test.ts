import { describe, it, expect } from 'vitest';
import { isInAppBrowser } from './inAppBrowser.ts';

describe('isInAppBrowser', () => {
  it('spots the apps Google refuses to sign in from', () => {
    expect(isInAppBrowser('Mozilla/5.0 (iPhone) [FBAN/FBIOS;FBAV/450.0]')).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 (Linux; Android 14) Instagram 300.0')).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 (Linux; Android 13) musical_ly_2023 BytedanceWebview')).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 (Linux; Android 14; SM-A546B; wv) AppleWebKit/537.36 Version/4.0')).toBe(true);
  });

  it('leaves a real browser alone', () => {
    expect(isInAppBrowser('Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36')).toBe(false);
    expect(isInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toBe(false);
  });
});
