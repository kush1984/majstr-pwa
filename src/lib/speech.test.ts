import { afterEach, describe, expect, it, vi } from 'vitest';
import { speechAvailability } from './speech.ts';

/**
 * The one thing this file really has to get right: the installed-iOS trap. Feature detection
 * SUCCEEDS in a WKWebView-based container, the microphone never opens, and every honest fallback
 * hangs on us refusing BEFORE we look for the constructor.
 */
describe('speechAvailability', () => {
  const originalUA = navigator.userAgent;
  const originalTouch = navigator.maxTouchPoints;
  const originalStandalone = (navigator as unknown as { standalone?: boolean }).standalone;
  const originalMatchMedia = window.matchMedia;
  const w = window as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  const originalSR = w.SpeechRecognition;
  const originalWK = w.webkitSpeechRecognition;

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: originalUA, configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: originalTouch, configurable: true });
    Object.defineProperty(navigator, 'standalone', { value: originalStandalone, configurable: true });
    window.matchMedia = originalMatchMedia;
    w.SpeechRecognition = originalSR;
    w.webkitSpeechRecognition = originalWK;
  });

  function setUA(ua: string, touchPoints = 0) {
    Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: touchPoints, configurable: true });
  }

  function setInstalled(installed: boolean) {
    Object.defineProperty(navigator, 'standalone', { value: installed, configurable: true });
    window.matchMedia = vi.fn().mockReturnValue({ matches: installed });
  }

  function withCtor(present: boolean) {
    if (present) {
      w.webkitSpeechRecognition = class {};
    } else {
      delete w.SpeechRecognition;
      delete w.webkitSpeechRecognition;
    }
  }

  it('refuses an installed iOS PWA even though the constructor is present', () => {
    // The load-bearing case for this file. Detection would say «ready» and the mic would never open.
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15');
    setInstalled(true);
    withCtor(true);

    expect(speechAvailability()).toBe('installedIos');
  });

  it('an iPad installed to the home screen looks like a Mac by UA — the touch count is the tell', () => {
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', /* touchPoints */ 5);
    setInstalled(true);
    withCtor(true);

    expect(speechAvailability()).toBe('installedIos');
  });

  it('iOS Safari IN THE BROWSER (not installed) is ready — the container is the problem, not iOS', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15');
    setInstalled(false);
    withCtor(true);

    expect(speechAvailability()).toBe('ready');
  });

  it('desktop Chrome with a constructor is ready — desktop is why the FAB now shows at all', () => {
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126');
    setInstalled(false);
    withCtor(true);

    expect(speechAvailability()).toBe('ready');
  });

  it('a browser without the constructor is unsupported — Firefox, older WebViews', () => {
    setUA('Mozilla/5.0 (Windows NT 10.0; rv:120.0) Gecko/20100101 Firefox/120');
    setInstalled(false);
    withCtor(false);

    expect(speechAvailability()).toBe('unsupported');
  });
});
