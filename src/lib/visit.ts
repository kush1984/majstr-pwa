import type { VisitKind, VisitRequest } from '@/api/types.ts';
import { config } from './config.ts';
import { getStoredFirstTouch, getStoredUtm } from './referral.ts';
import { tokens } from './tokens.ts';

/**
 * Anonymous visit counting for the public pages (backend V187): the landing, /login, /register,
 * /privacy, and the SEO pages, which are separate documents and call {@link sendVisit} themselves.
 *
 * Nothing here identifies anyone: no cookie and no id of our own. The server counts a browser once a
 * day under a salt it throws away the next day. A signed-in master is not a visitor, and a browser
 * that asks not to be tracked (Global Privacy Control, Do Not Track) sends nothing.
 *
 * The source fields are the stored FIRST touch, the very values registration sends, so the admin can
 * put a channel's visitors and its registrations side by side.
 */

/** The SPA's public pages. Every other path is the app itself, or a page that carries a token. */
const PUBLIC_PATHS = new Set(['/', '/login', '/register', '/privacy']);

export function sendVisit(kind: VisitKind, path: string): void {
  try {
    if (tokens.hasAny() || declinesTracking()) return;
    const body: VisitRequest = {
      kind,
      path,
      ...getStoredFirstTouch(),
      ...getStoredUtm(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
      language: navigator.language || undefined,
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

interface RouterLike {
  state: { location: { pathname: string } };
  subscribe(listener: (state: { location: { pathname: string } }) => void): unknown;
}

/** Counts the SPA's public pages: the one it opened on, and each one navigated to after it. */
export function trackPublicVisits(router: RouterLike): void {
  let last: string | null = null;
  const seen = (pathname: string) => {
    if (pathname === last) return;
    last = pathname;
    if (PUBLIC_PATHS.has(pathname)) sendVisit('PAGEVIEW', pathname);
  };
  seen(router.state.location.pathname);
  router.subscribe((state) => seen(state.location.pathname));
}

function declinesTracking(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string | null };
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1';
}
