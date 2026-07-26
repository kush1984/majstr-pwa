/**
 * Token storage.
 *
 * We use localStorage. The trade-off:
 *
 * - localStorage is readable by any JS running on the origin, so an XSS
 *   bug would let an attacker steal the tokens. We mitigate by: strict
 *   CSP (planned), no dangerouslySetInnerHTML in our code, no untrusted
 *   third-party scripts, sanitising every value rendered into the DOM.
 * - sessionStorage would force a re-login every time the user closes the
 *   tab. For a PWA you launch from the home screen daily, that breaks
 *   the "feels like an app" promise — non-starter.
 * - in-memory only would drop tokens on full reload and on every SW
 *   update, same UX issue.
 * - httpOnly cookies would be safer from XSS, but the backend currently
 *   returns tokens in the JSON body. Migrating to cookie-based auth is
 *   a backend change tracked in the open-questions log.
 *
 * Net: localStorage now, with an upgrade path to httpOnly cookies once
 * the backend supports them.
 */

const ACCESS_TOKEN_KEY = 'majstr.accessToken';
const REFRESH_TOKEN_KEY = 'majstr.refreshToken';

export const tokens = {
  getAccess(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  },
  getRefresh(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  },
  set(access: string, refresh: string): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, access);
    localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
  },
  clear(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  },
  hasAny(): boolean {
    return localStorage.getItem(ACCESS_TOKEN_KEY) !== null;
  },
  /**
   * The signed-in user's id, read from the access token's `sub` — null when there is no
   * token or it isn't decodable.
   *
   * <p>Used to stamp every queued offline write with its owner, so unsynced work can
   * survive a logout and be offered back to the SAME master on the next login, while ops
   * belonging to somebody else are dropped rather than replayed into the wrong account.
   *
   * <p>Not a security check — the payload is unverified base64, and a tampered token would
   * be rejected by the server anyway. It is an ownership TAG, and it is only ever used to
   * decide what to discard.
   */
  ownerId(): string | null {
    const token = localStorage.getItem(ACCESS_TOKEN_KEY);
    const payload = token?.split('.')[1];
    if (!payload) return null;
    try {
      const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string };
      return typeof json.sub === 'string' ? json.sub : null;
    } catch {
      return null;
    }
  },
};
