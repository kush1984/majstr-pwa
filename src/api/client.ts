import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import { config, routes } from '@/lib/config.ts';
import { tokens } from '@/lib/tokens.ts';
import i18n from '@/lib/i18n.ts';
import type { AuthResponse } from './types.ts';

/**
 * Axios instance shared across the whole app.
 *
 * Token lifecycle, designed so we never spam the backend with a token we
 * already know is dead:
 *
 * 1. Request interceptor: if the access token's `exp` has already passed,
 *    refresh it BEFORE sending (proactive). Then attach the bearer. This is
 *    what stops the classic "expired JWT hammered in a loop" — we don't fire
 *    a request with a known-expired token and wait for the 401.
 * 2. Response interceptor (401): a token that looked valid but the server
 *    rejected (expired mid-flight, revoked) → refresh once and retry the
 *    original request a single time (`_retry` guard).
 * 3. Refresh is single-flight: concurrent callers share one `/api/auth/refresh`
 *    promise, so a stampede of queries triggers exactly one rotation.
 * 4. Refresh failures are CLASSIFIED: a 4xx from /api/auth/refresh means the
 *    token is genuinely dead → clear storage and redirect to /login ONCE
 *    (`redirectingToLogin` latch), pending requests reject. A network error
 *    or 5xx is transient → the failing request rejects but tokens are KEPT;
 *    we never log the user out because of a blip or a backend hiccup.
 */

interface RetryableRequest extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

export const api = axios.create({
  baseURL: config.apiBaseUrl,
  headers: { 'Content-Type': 'application/json' },
});

// ---------- token expiry (client-side, best-effort) ----------

/** Read a JWT's `exp` (seconds since epoch). null if it isn't a decodable JWT. */
function jwtExp(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    ) as { exp?: number };
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

/**
 * True only when we can PROVE the stored access token is past its `exp`
 * (with a 10s skew). If the token can't be decoded we return false and let
 * the server be the judge — never log the user out on a guess.
 */
function accessTokenExpired(): boolean {
  const token = tokens.getAccess();
  if (!token) return false;
  const exp = jwtExp(token);
  if (exp === null) return false;
  return Date.now() >= exp * 1000 - 10_000;
}

// ---------- single-flight refresh ----------

let refreshInFlight: Promise<string | null> | null = null;
let redirectingToLogin = false;

/**
 * Refresh the access token, deduped: concurrent callers await the same
 * promise so we rotate the refresh token exactly once. Resolves to the new
 * access token, or `null` if auth is DEAD (no refresh token, or the server
 * definitively rejected it with a 4xx) — callers treat `null` as "log out".
 *
 * REJECTS on transient failures (network down, backend 5xx): we must NOT log
 * the user out then — the refresh token is still perfectly valid, the server
 * just couldn't be reached. Callers propagate the error so the original
 * request fails like any other transient failure (and React Query's retry
 * policy gets its shot), with tokens intact.
 */
function runRefresh(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefresh(): Promise<string | null> {
  const refreshToken = tokens.getRefresh();
  if (!refreshToken) return null;
  try {
    // Plain axios (not `api`) so this call skips the interceptors and cannot
    // itself trigger another refresh attempt.
    const resp = await axios.post<AuthResponse>(
      `${config.apiBaseUrl}/api/auth/refresh`,
      { refreshToken },
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (!resp.data?.accessToken || !resp.data?.refreshToken) return null;
    tokens.set(resp.data.accessToken, resp.data.refreshToken);
    return resp.data.accessToken;
  } catch (err) {
    // The server SAW the token and said no (401 expired/revoked/rotated-away,
    // or any other 4xx) → auth is genuinely dead.
    if (
      axios.isAxiosError(err) &&
      err.response &&
      err.response.status >= 400 &&
      err.response.status < 500
    ) {
      return null;
    }
    // No response (offline / DNS / timeout) or 5xx → transient; keep tokens.
    throw err;
  }
}

/** Clear auth and bounce to /login — at most once, even under a stampede. */
function forceLogin(): void {
  tokens.clear();
  if (!redirectingToLogin && window.location.pathname !== routes.login) {
    redirectingToLogin = true;
    // Hard redirect drops in-memory React state + cached queries.
    window.location.href = routes.login;
  }
}

/**
 * Returns a usable access token, refreshing first if the current one is
 * already expired. `null` means auth is dead (and a redirect has been kicked
 * off); a transient refresh failure (network/5xx) REJECTS instead — the
 * caller's request fails but the session survives. Exported for the few
 * bearer calls that bypass axios (e.g. PDF blob fetch) so they get the same
 * proactive-refresh guarantee.
 */
export async function ensureAccessToken(): Promise<string | null> {
  if (accessTokenExpired()) {
    const fresh = await runRefresh();
    if (!fresh) {
      forceLogin();
      return null;
    }
    return fresh;
  }
  return tokens.getAccess();
}

// ---------- request: proactively refresh, then attach bearer ----------

api.interceptors.request.use(async (req) => {
  // If we can already see the token is expired, rotate it before sending
  // instead of firing a doomed request and bouncing off a 401. A transient
  // refresh failure rejects here (runRefresh throws) — the request fails as a
  // network error, React Query may retry it, and the tokens stay put.
  if (accessTokenExpired()) {
    const fresh = await runRefresh();
    if (!fresh) {
      forceLogin();
      // Abort: never send a request we know will 401.
      throw new axios.CanceledError(i18n.t('errors.sessionExpired'));
    }
  }
  const token = tokens.getAccess();
  if (token) {
    req.headers.Authorization = `Bearer ${token}`;
  }
  return req;
});

// ---------- response: refresh on 401, retry once ----------

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const original = error.config as RetryableRequest | undefined;
  const status = error.response?.status;

  // Bail fast on non-401, already-retried, and the auth calls themselves.
  if (
    !original ||
    status !== 401 ||
    original._retry ||
    original.url?.includes('/api/auth/refresh') ||
    original.url?.includes('/api/auth/login')
  ) {
    return Promise.reject(error);
  }

  original._retry = true;

  let fresh: string | null;
  try {
    fresh = await runRefresh();
  } catch {
    // Transient refresh failure — surface the ORIGINAL 401 to the caller and
    // keep tokens: the session is probably still fine, the network wasn't.
    return Promise.reject(error);
  }
  if (!fresh) {
    forceLogin();
    return Promise.reject(error);
  }

  original.headers.Authorization = `Bearer ${fresh}`;
  return api(original);
});

/** Escape hatch for components that want to fire a one-off request
 *  without the auth bearer (e.g. /register, /login).
 */
export function rawApi(cfg: AxiosRequestConfig) {
  return axios.request({ baseURL: config.apiBaseUrl, ...cfg });
}
