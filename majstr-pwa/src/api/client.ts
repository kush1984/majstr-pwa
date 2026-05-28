import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import { config } from '@/lib/config';
import { tokens } from '@/lib/tokens';
import type { AuthResponse } from './types';

/**
 * Axios instance shared across the whole app.
 *
 * Two interceptors:
 *
 * 1. Request: attach `Authorization: Bearer <accessToken>` if we have one.
 * 2. Response (401): try to refresh the access token via /api/auth/refresh,
 *    then retry the original request. If refresh itself fails or there is
 *    no refresh token, clear storage and redirect to /login.
 *
 * Concurrent 401s reuse the same in-flight refresh promise — without
 * that, ten parallel /me calls during app boot would each fire their
 * own refresh, race each other, and rotate the token N times.
 */

interface RetryableRequest extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

export const api = axios.create({
  baseURL: config.apiBaseUrl,
  headers: { 'Content-Type': 'application/json' },
});

// ---------- request: attach bearer ----------

api.interceptors.request.use((req) => {
  const token = tokens.getAccess();
  if (token) {
    req.headers.Authorization = `Bearer ${token}`;
  }
  return req;
});

// ---------- response: refresh on 401 ----------

let refreshInFlight: Promise<string> | null = null;

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const original = error.config as RetryableRequest | undefined;
  const status = error.response?.status;

  // Bail fast on non-401, retries, and refresh calls themselves.
  if (
    !original ||
    status !== 401 ||
    original._retry ||
    original.url?.includes('/api/auth/refresh') ||
    original.url?.includes('/api/auth/login')
  ) {
    return Promise.reject(error);
  }

  const refreshToken = tokens.getRefresh();
  if (!refreshToken) {
    handleAuthFailure();
    return Promise.reject(error);
  }

  original._retry = true;

  try {
    refreshInFlight ??= refreshAccessToken(refreshToken);
    const newAccess = await refreshInFlight;
    original.headers.Authorization = `Bearer ${newAccess}`;
    return api(original);
  } catch (refreshErr) {
    handleAuthFailure();
    return Promise.reject(refreshErr);
  } finally {
    refreshInFlight = null;
  }
});

async function refreshAccessToken(refreshToken: string): Promise<string> {
  // Use raw axios (not our instance) so this call skips the interceptors
  // and cannot itself trigger another refresh attempt.
  const resp = await axios.post<AuthResponse>(
    `${config.apiBaseUrl}/api/auth/refresh`,
    { refreshToken },
    { headers: { 'Content-Type': 'application/json' } },
  );
  tokens.set(resp.data.accessToken, resp.data.refreshToken);
  return resp.data.accessToken;
}

function handleAuthFailure(): void {
  tokens.clear();
  // Hard redirect to drop in-memory React state + cached queries.
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

/** Escape hatch for components that want to fire a one-off request
 *  without the auth bearer (e.g. /register, /login).
 */
export function rawApi(cfg: AxiosRequestConfig) {
  return axios.request({ baseURL: config.apiBaseUrl, ...cfg });
}
