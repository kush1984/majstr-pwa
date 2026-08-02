import * as Sentry from '@sentry/react';
import { config } from '@/lib/config.ts';

/**
 * Client-side error reporting.
 *
 * Disabled by default: with an empty `VITE_SENTRY_DSN` (the dev default) we
 * never call `Sentry.init`, so nothing is collected or sent and the SDK stays
 * out of the way locally. Production sets a real DSN and we capture unhandled
 * errors + React render errors (the global ErrorBoundary forwards those here).
 *
 * Privacy: we never want tokens or credentials leaving the browser. We disable
 * automatic PII (`sendDefaultPii: false`) and run a `beforeSend` scrubber that
 * strips Authorization headers, auth request bodies, and any token-shaped query
 * params from the captured payload before it leaves the device.
 */

let initialized = false;

export function initSentry(): void {
  if (initialized || !config.sentryDsn) return;
  initialized = true;

  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.sentryEnvironment,
    // No automatic IP / cookie / user collection — we add only what we choose.
    sendDefaultPii: false,
    // Keep it lightweight: errors only, no performance tracing / replay by
    // default (can be turned on later if needed).
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
}

/**
 * Tag the current Sentry scope with the logged-in user's id (NOT email / name —
 * no PII). Call on login / `/me`; pass `null` on logout to clear it.
 */
export function setSentryUser(userId: string | null): void {
  if (!config.sentryDsn) return;
  Sentry.setUser(userId ? { id: userId } : null);
}

/** Manually report a handled error (e.g. from the ErrorBoundary). No-op when disabled. */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!config.sentryDsn) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

// ---------- scrubbers ----------

const SENSITIVE_HEADER = /^(authorization|cookie|set-cookie|x-auth-token)$/i;
const TOKEN_QUERY = /([?&](?:access_?token|refresh_?token|token|code)=)[^&#]*/gi;
const AUTH_PATH = /\/api\/auth\/(login|register|refresh|logout)/i;

function scrubHeaders(headers: unknown): void {
  if (!headers || typeof headers !== 'object') return;
  for (const key of Object.keys(headers)) {
    if (SENSITIVE_HEADER.test(key)) {
      (headers as Record<string, unknown>)[key] = '[redacted]';
    }
  }
}

function scrubUrl(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  return url.replace(TOKEN_QUERY, '$1[redacted]');
}

// Exported for unit tests; used internally by `Sentry.init` above.
/**
 * Analytics beacons we neither ship nor can fix.
 *
 * Cloudflare injects `beacon.min.js` at the edge to measure Core Web Vitals. On an old browser its
 * CLS observer throws — `this.i.at is not a function`, because `Array.prototype.at` arrived in
 * Chrome 92 and a master turned up on Chrome 83 (Huawei P20, Android 10). Nothing about that is
 * ours: the app itself runs there, which that very event proves — it carried our React context, so
 * our bundle had parsed and initialised before the beacon failed.
 *
 * Deliberately a NAMED list rather than "drop anything not from our origin". The broad version
 * would also swallow errors thrown from a browser extension's wrapper, a service-worker frame, or
 * a stack we simply failed to symbolicate — and a rule that can hide our own bugs to reduce noise
 * is a bad trade.
 */
const THIRD_PARTY_BEACONS = /(?:cloudflareinsights\.com|\/beacon\.min\.js)/i;

/** True when EVERY frame comes from such a beacon — one of our frames anywhere keeps the event. */
function isThirdPartyBeaconNoise(event: Sentry.ErrorEvent): boolean {
  const frames = event.exception?.values?.flatMap((v) => v.stacktrace?.frames ?? []) ?? [];
  if (frames.length === 0) return false;
  return frames.every((f) => THIRD_PARTY_BEACONS.test(f.filename ?? f.abs_path ?? ''));
}

export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  if (isThirdPartyBeaconNoise(event)) {
    return null;
  }
  const req = event.request;
  if (req) {
    scrubHeaders(req.headers);
    const cleanUrl = scrubUrl(req.url);
    if (cleanUrl) req.url = cleanUrl;
    // Never ship request bodies of the auth endpoints (they carry credentials
    // / tokens). For everything else we also drop the body to be safe — error
    // diagnosis rarely needs it and it's the riskiest field.
    if (req.data !== undefined) req.data = '[redacted]';
  }
  return event;
}

// Exported for unit tests; used internally by `Sentry.init` above.
export function scrubBreadcrumb(crumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  // axios/fetch breadcrumbs can carry the request URL with token query params.
  const url = crumb.data?.url;
  if (typeof url === 'string') {
    if (AUTH_PATH.test(url)) {
      // Don't even keep a breadcrumb for the credential-bearing auth calls.
      return null;
    }
    const clean = scrubUrl(url);
    if (clean && crumb.data) crumb.data.url = clean;
  }
  return crumb;
}
