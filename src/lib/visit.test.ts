import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendVisit, trackPublicVisits } from './visit.ts';
import { tokens } from './tokens.ts';

/**
 * The visit beacon (backend V187): what it sends, and the visitors it sends nothing about.
 */

const fetchMock = vi.fn();

function sentBodies(): Record<string, unknown>[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string) as Record<string, unknown>);
}

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'globalPrivacyControl');
  Reflect.deleteProperty(navigator, 'doNotTrack');
});

describe('sendVisit', () => {
  it('sends the page with the stored first touch, keeps no cookie, and survives the page closing', () => {
    localStorage.setItem('majstr.entry', JSON.stringify({ referrerHost: 'google.com', entryPath: '/kalkulyator-plytky' }));
    localStorage.setItem('majstr.utm', JSON.stringify({ utmSource: 'tiktok', utmCampaign: 'spring' }));

    sendVisit('PAGEVIEW', '/register');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/public\/visit$/);
    expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit' });
    expect(sentBodies()[0]).toMatchObject({
      kind: 'PAGEVIEW',
      path: '/register',
      referrerHost: 'google.com',
      entryPath: '/kalkulyator-plytky',
      utmSource: 'tiktok',
      utmCampaign: 'spring',
    });
    expect(typeof sentBodies()[0].timeZone).toBe('string');
  });

  it('says nothing about a signed-in master: he is not a visitor', () => {
    tokens.set('h.e30.s', 'r');

    sendVisit('PAGEVIEW', '/');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says nothing for a browser that asks not to be tracked', () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: true });
    sendVisit('PAGEVIEW', '/');
    Reflect.deleteProperty(navigator, 'globalPrivacyControl');
    Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '1' });
    sendVisit('PAGEVIEW', '/');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never breaks the page when the network fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));

    expect(() => sendVisit('PAGEVIEW', '/')).not.toThrow();
    await Promise.resolve();
  });
});

describe('trackPublicVisits', () => {
  function fakeRouter(start: string) {
    const listeners: ((state: { location: { pathname: string } }) => void)[] = [];
    return {
      state: { location: { pathname: start } },
      subscribe: (listener: (state: { location: { pathname: string } }) => void) => listeners.push(listener),
      go: (pathname: string) => listeners.forEach((l) => l({ location: { pathname } })),
    };
  }

  it('counts the page it opened on and each public page navigated to, once each', () => {
    const router = fakeRouter('/');
    trackPublicVisits(router);
    router.go('/');
    router.go('/register');
    router.go('/register');

    expect(sentBodies().map((b) => b.path)).toEqual(['/', '/register']);
  });

  it('counts none of the app itself, nor a page that carries a token', () => {
    const router = fakeRouter('/projects');
    trackPublicVisits(router);
    router.go('/reset-password');
    router.go('/verify-email');
    router.go('/estimates/1');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
