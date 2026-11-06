import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { derivedLabel, sendVisit, stopTracking, trackPage, trackPublicVisits } from './visit.ts';
import { tokens } from './tokens.ts';

/**
 * The visit beacon (backend V187, V188): what it sends, and the visitors it sends nothing about.
 */

const fetchMock = vi.fn();
let visibility: DocumentVisibilityState = 'visible';

function sentBodies(): Record<string, unknown>[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string) as Record<string, unknown>);
}

function sent(kind: string): Record<string, unknown>[] {
  return sentBodies().filter((b) => b.kind === kind);
}

/** jsdom lays nothing out: give the page a height and the window a scroll position. */
function scrolledTo(scrollY: number, pageHeight = 2000, viewport = 800): void {
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: pageHeight });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewport });
  Object.defineProperty(window, 'scrollY', { configurable: true, value: scrollY });
  window.dispatchEvent(new Event('scroll'));
}

function setVisibility(state: DocumentVisibilityState): void {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

function fakeRouter(start: string) {
  const listeners: ((state: { location: { pathname: string } }) => void)[] = [];
  return {
    state: { location: { pathname: start } },
    subscribe: (listener: (state: { location: { pathname: string } }) => void) => listeners.push(listener),
    go: (pathname: string) => listeners.forEach((l) => l({ location: { pathname } })),
  };
}

/** A link click must not make jsdom try to navigate. */
const stayOnPage = (event: Event) => event.preventDefault();

function click(html: string): void {
  document.body.innerHTML = html;
  (document.body.firstElementChild as HTMLElement).click();
}

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  scrolledTo(0);
  document.addEventListener('click', stayOnPage);
});

afterEach(() => {
  stopTracking();
  document.removeEventListener('click', stayOnPage);
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const key of ['globalPrivacyControl', 'doNotTrack', 'webdriver']) Reflect.deleteProperty(navigator, key);
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

  it('carries what a click or a step names', () => {
    sendVisit('CLICK', '/', { target: 'hero:register' });

    expect(sentBodies()[0]).toMatchObject({ kind: 'CLICK', path: '/', target: 'hero:register' });
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

  it('says nothing for a browser a program drives: a crawler or a test is not a visitor', () => {
    Object.defineProperty(navigator, 'webdriver', { configurable: true, value: true });

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
  it('counts the page it opened on and each public page navigated to, once each', () => {
    const router = fakeRouter('/');
    trackPublicVisits(router);
    router.go('/');
    router.go('/register');
    router.go('/register');

    expect(sent('PAGEVIEW').map((b) => b.path)).toEqual(['/', '/register']);
  });

  it('counts none of the app itself, nor a page that carries a token', () => {
    const router = fakeRouter('/projects');
    trackPublicVisits(router);
    router.go('/reset-password');
    router.go('/verify-email');
    router.go('/estimates/1');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says how far and how long the page was read when the visitor moves on', () => {
    vi.useFakeTimers();
    const router = fakeRouter('/');
    trackPublicVisits(router);
    vi.advanceTimersByTime(12_000);
    scrolledTo(400);
    scrolledTo(100);

    router.go('/register');

    expect(sent('LEAVE')).toEqual([expect.objectContaining({ path: '/', scrollDepth: 60, engagedSeconds: 12 })]);
  });

  it('counts only the time the page was on screen, and says it once however it is left', () => {
    vi.useFakeTimers();
    trackPublicVisits(fakeRouter('/'));
    vi.advanceTimersByTime(5_000);
    setVisibility('hidden');
    vi.advanceTimersByTime(60_000);
    window.dispatchEvent(new Event('pagehide'));
    setVisibility('visible');
    vi.advanceTimersByTime(3_000);
    window.dispatchEvent(new Event('pagehide'));

    expect(sent('LEAVE').map((b) => b.engagedSeconds)).toEqual([5, 8]);
  });

  it('names a click by its label, or a link by where it goes', () => {
    trackPublicVisits(fakeRouter('/'));

    click('<a href="/register" data-track="hero:register"><span>Почати</span></a>');
    click('<a href="/kalkulyator-plytky">Плитка</a>');
    click('<button type="button">Меню</button>');

    expect(sent('CLICK').map((b) => [b.path, b.target])).toEqual([
      ['/', 'hero:register'],
      ['/', 'link:/kalkulyator-plytky'],
    ]);
  });

  it('counts no click inside the app', () => {
    const router = fakeRouter('/');
    trackPublicVisits(router);
    router.go('/projects');
    fetchMock.mockClear();

    click('<a href="/register" data-track="hero:register">Почати</a>');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('trackPage', () => {
  it('is one page view for as long as the document is open', () => {
    vi.useFakeTimers();
    trackPage('/kalkulyator-plytky');
    vi.advanceTimersByTime(30_000);
    click('<button type="submit">Порахувати</button>');
    window.dispatchEvent(new Event('pagehide'));

    expect(sentBodies().map((b) => [b.kind, b.path, b.target ?? b.engagedSeconds])).toEqual([
      ['PAGEVIEW', '/kalkulyator-plytky', undefined],
      ['CLICK', '/kalkulyator-plytky', 'submit'],
      ['LEAVE', '/kalkulyator-plytky', 30],
    ]);
  });
});

describe('derivedLabel', () => {
  function anchor(href: string): HTMLAnchorElement {
    const a = document.createElement('a');
    a.setAttribute('href', href);
    return a;
  }

  it('reads a link by where it goes, never by its words', () => {
    expect(derivedLabel(anchor('#faq'))).toBe('anchor:#faq');
    expect(derivedLabel(anchor('mailto:hello@majstr.pro'))).toBe('link:mailto');
    expect(derivedLabel(anchor('https://www.tiktok.com/@majstr'))).toBe('link:www.tiktok.com');
    expect(derivedLabel(anchor('/zrazok-akta?x=1'))).toBe('link:/zrazok-akta');
  });

  it('leaves an unnamed button or block unnamed', () => {
    const plain = document.createElement('button');
    plain.type = 'button';
    expect(derivedLabel(plain)).toBeNull();
    expect(derivedLabel(document.createElement('summary'))).toBeNull();
  });
});
