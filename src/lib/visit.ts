import type { VisitKind, VisitRequest } from '@/api/types.ts';
import { config } from './config.ts';
import { getStoredFirstTouch, getStoredUtm } from './referral.ts';
import { tokens } from './tokens.ts';

/**
 * Anonymous visit counting for the public pages (backend V187, V188): the landing, /login, /register,
 * /privacy, and the SEO pages, which are separate documents and call {@link trackPage} themselves.
 *
 * Nothing here identifies anyone: no cookie and no id of our own. The server counts a browser once a
 * day under a salt it throws away the next day. A signed-in master is not a visitor; a browser that
 * asks not to be tracked (Global Privacy Control, Do Not Track) or is driven by a program
 * (`navigator.webdriver`) sends nothing.
 *
 * Per page view: PAGEVIEW on arrival; LEAVE with how far it was read and for how long, whenever the
 * page is hidden, closed or navigated away from; CLICK with the label of what was pressed. Never a
 * text the visitor typed.
 */

/** The SPA's public pages. Every other path is the app itself, or a page that carries a token. */
const PUBLIC_PATHS = new Set(['/', '/login', '/register', '/privacy']);
/** Past an hour on screen it is a tab left open, not reading; the server caps there too. */
const MAX_SECONDS = 3600;
const MAX_LABEL = 60;

export interface VisitDetail {
  target?: string;
  scrollDepth?: number;
  engagedSeconds?: number;
}

export function sendVisit(kind: VisitKind, path: string, detail: VisitDetail = {}): void {
  try {
    if (tokens.hasAny() || declinesTracking() || navigator.webdriver) return;
    const body: VisitRequest = {
      kind,
      path,
      ...getStoredFirstTouch(),
      ...getStoredUtm(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
      language: navigator.language || undefined,
      ...detail,
    };
    void fetch(`${config.apiBaseUrl}/api/public/visit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
      credentials: 'omit',
    }).catch(() => undefined);
  } catch {
    /* counting is best-effort and must never break a page */
  }
}

interface View {
  path: string;
  /** Deepest per cent of the page that reached the bottom of the screen. */
  depth: number;
  visibleMs: number;
  /** When the page last became visible; null while it is hidden. */
  since: number | null;
  /** What the last LEAVE said, so hiding and then closing does not say it twice. */
  sent: string;
}

let view: View | null = null;
let installed = false;

function depthNow(): number {
  const height = document.documentElement.scrollHeight;
  if (height <= 0) return 0;
  return Math.min(100, Math.round(((window.scrollY + window.innerHeight) / height) * 100));
}

function begin(path: string): void {
  // Not measured yet: the page may not have rendered. The first scroll, or the moment it is left, does it.
  view = {
    path,
    depth: 0,
    visibleMs: 0,
    since: document.visibilityState === 'visible' ? Date.now() : null,
    sent: '',
  };
  sendVisit('PAGEVIEW', path);
}

/**
 * Says how far and how long, once per change: hiding the tab, closing the page, navigating away. A SPA
 * navigation does not measure: the screen may already show the next page.
 */
function report(measure: boolean): void {
  if (!view) return;
  if (measure) view.depth = Math.max(view.depth, depthNow());
  if (view.since !== null) {
    view.visibleMs += Date.now() - view.since;
    view.since = null;
  }
  const seconds = Math.min(MAX_SECONDS, Math.round(view.visibleMs / 1000));
  const said = `${view.depth}:${seconds}`;
  if (said === view.sent) return;
  view.sent = said;
  sendVisit('LEAVE', view.path, { scrollDepth: view.depth, engagedSeconds: seconds });
}

const onScroll = () => {
  if (view) view.depth = Math.max(view.depth, depthNow());
};

const onVisibility = () => {
  if (!view) return;
  if (document.visibilityState === 'hidden') report(true);
  else if (view.since === null) view.since = Date.now();
};

const onPageHide = () => report(true);

const onClick = (event: MouseEvent) => {
  if (!view || !(event.target instanceof Element)) return;
  const el = event.target.closest('[data-track], a[href], button, summary');
  const label = el && (el.getAttribute('data-track') ?? derivedLabel(el));
  if (label) sendVisit('CLICK', view.path, { target: label.slice(0, MAX_LABEL) });
};

function install(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('click', onClick, true);
}

/**
 * What a pressed element is called when nobody named it: a link by where it goes, a submit button
 * «submit». Anything else needs a `data-track` to be counted.
 */
export function derivedLabel(el: Element): string | null {
  if (el instanceof HTMLAnchorElement) {
    const href = el.getAttribute('href') ?? '';
    if (href.startsWith('#')) return `anchor:${href}`;
    if (href.startsWith('mailto:')) return 'link:mailto';
    if (href.startsWith('tel:')) return 'link:tel';
    try {
      const url = new URL(href, window.location.href);
      return url.origin === window.location.origin ? `link:${url.pathname}` : `link:${url.hostname}`;
    } catch {
      return null;
    }
  }
  if (el instanceof HTMLButtonElement && el.type === 'submit') return 'submit';
  return null;
}

interface RouterLike {
  state: { location: { pathname: string } };
  subscribe(listener: (state: { location: { pathname: string } }) => void): unknown;
}

/** The SPA's public pages: the one it opened on, and each one navigated to after it. */
export function trackPublicVisits(router: RouterLike): void {
  install();
  let last: string | null = null;
  const seen = (pathname: string) => {
    if (pathname === last) return;
    last = pathname;
    report(false);
    view = null;
    if (PUBLIC_PATHS.has(pathname)) begin(pathname);
  };
  seen(router.state.location.pathname);
  router.subscribe((state) => seen(state.location.pathname));
}

/** A separate document (an SEO page): one page view for as long as it is open. */
export function trackPage(path: string): void {
  install();
  begin(path);
}

/** Tests only: listeners and the open view do not outlive a test. */
export function stopTracking(): void {
  window.removeEventListener('scroll', onScroll);
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('pagehide', onPageHide);
  document.removeEventListener('click', onClick, true);
  installed = false;
  view = null;
}

function declinesTracking(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string | null };
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1';
}
