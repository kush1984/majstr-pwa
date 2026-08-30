import type { PostHog } from 'posthog-js';
import { config } from '@/lib/config.ts';
import type { UserResponse } from '@/api/types.ts';
import { getStoredRef, getStoredUtm } from '@/lib/referral.ts';

/**
 * Product analytics + session replay (PostHog) — the event-shaped counterpart to the backend's
 * state-shaped activation funnel.
 *
 * The funnel answers «how many masters ever reached state X»; it knows nothing about time, cohorts,
 * or what happened BETWEEN two steps. Replay does — and that, not dashboards, is why this is here:
 * to see why a master built an estimate and never sent it.
 *
 * Disabled by default, exactly like Sentry: with an empty `VITE_POSTHOG_KEY` (the dev default) the
 * SDK is never even imported — the `import('posthog-js')` below runs only behind a real key, so
 * nothing is downloaded, nothing is sent, and local development is untouched.
 *
 * Two rules this module exists to enforce, both privacy-driven:
 *
 *  1. **Nothing is captured before consent.** We init with `opt_out_capturing_by_default: true` and
 *     only `opt_in_capturing()` once the master's privacy consent is stamped. An anonymous visitor
 *     — including a client who opened `/privacy` from a portal link — never opts in, so they are
 *     never recorded. (The client portal itself is `static/portal/index.html`, a different page
 *     that does not load this bundle at all.)
 *  2. **No personal data leaves the device.** Autocapture is OFF (it ships the text of whatever was
 *     clicked — client names and sums would land in event names), pageviews are off (the event list
 *     below is closed), replay masks every input and every `.ph-mask` container, and the person is
 *     identified by UUID with a fixed, reviewed property set — never an email, name or phone.
 *
 * Replay lives HERE and only here — Sentry's replay stays off (`sentry.ts` has no replay
 * integration on purpose). Two recorders would double the cost and record the same screens twice.
 */

/**
 * The closed event list. Deliberately a typed map rather than a free `capture(name, props)`:
 * "just in case" events are how an analytics layer turns into noise nobody trusts.
 *
 * Two events are deliberately ABSENT, and neither is an oversight:
 *
 *  - **`checkout_started`** — the backend already persists a PENDING `Payment` row (period +
 *    auto-renew intent) on every `POST /api/billing/checkout`, before the redirect. Money belongs
 *    to the backend; a second, independent count would drift from it within a month.
 *  - **`estimate_signed`** — the master's app has NO signing path. An estimate is signed by the
 *    CLIENT in the public portal, which is a separate page and a person who never consented to
 *    being measured. `withSigned` in the admin funnel is the honest source for that number.
 */
interface EventMap {
  registered: { source?: string; utm_source?: string };
  email_verified: undefined;
  /** No `isFirst` flag on this or the next one, deliberately: PostHog already knows a person's
   *  FIRST occurrence of an event, and a flag computed off the local cache would be wrong on a
   *  reinstall and unknowable offline. `hasClient` is the real signal here — objects created
   *  with no client attached never reach a share. */
  project_created: { hasClient: boolean };
  estimate_created: { itemCount: number; fromTemplate: boolean };
  /** `scope` is NOT cosmetic: `'estimate'` is the per-estimate `?t=` link from the estimate
   *  editor, `'object'` is a published set on the object portal (`?p=`/`?e=`). Merged into one
   *  event they hide exactly the distinction the backend funnel had to be fixed to see. */
  estimate_shared: { scope: 'estimate' | 'object'; channel: 'link' | 'email' };
  act_created: undefined;
  /** Act sharing (`?a=`) is its own event, never a third `scope` on `estimate_shared`. */
  act_shared: { channel: 'link' | 'email' };
  /** Only the OFFLINE signature — the one a master performs in their own browser. A portal
   *  signature happens in the client's browser and is deliberately not measured, so this event
   *  must never be read as "acts signed". */
  act_signed: { mode: 'offline' };
}

type EventName = keyof EventMap;
type EventArgs<K extends EventName> = EventMap[K] extends undefined ? [] : [props: EventMap[K]];

/** Resolves to the SDK once it has loaded, or to `null` when analytics is disabled/failed. */
let loading: Promise<PostHog | null> | null = null;

/**
 * Load + initialise the SDK. Call once on app boot; a no-op without a key.
 *
 * Nothing is captured yet — see `setAnalyticsConsent`.
 */
export function initPostHog(): void {
  if (loading || !config.posthogKey) return;
  loading = import('posthog-js')
    .then(({ posthog }) => {
      posthog.init(config.posthogKey, {
        api_host: config.posthogHost,
        // ---- consent ----
        // Nothing at all until the master has agreed to the privacy policy.
        opt_out_capturing_by_default: true,
        // ---- what we capture ----
        // Autocapture reads the text of the element that was clicked — that is how a client's name
        // or an estimate total ends up inside an event name. Only the explicit list above is sent.
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        // Only identified masters get a person profile; an anonymous visitor never becomes a row.
        person_profiles: 'identified_only',
        // ---- session replay ----
        // NB: masking options live INSIDE `session_recording`. Put at the top level they are
        // silently ignored, and the only way to find that out is to watch your own recording.
        session_recording: {
          maskAllInputs: true,
          // ONE class, hung on whole sensitive containers (client card, profile requisites, the
          // economy tab, payment rows, PDF previews). A per-selector list is a list someone
          // forgets to extend when the next screen ships.
          maskTextSelector: '.ph-mask',
          // 100 %, on purpose. The free tier allows 5k recordings/month, which this scale cannot
          // approach, and replay is the entire reason PostHog is here — sampling would save a
          // resource we are not short of at the cost of the thing we came for. Lower it only when
          // the quota is genuinely close.
          sampleRate: config.posthogReplaySampleRate,
        },
      });
      return posthog;
    })
    .catch(() => null); // analytics must never break a working flow — fail soft, like push
}

/**
 * Opt in / out of capturing. Call with the master's consent state (`me.consentedToPrivacyAt`).
 *
 * Not «init only after consent»: the SDK boots opted OUT, so a session before consent sends
 * nothing, and the moment consent is stamped capturing starts without a reload.
 */
export function setAnalyticsConsent(granted: boolean): void {
  withClient((ph) => {
    if (granted) ph.opt_in_capturing();
    else ph.opt_out_capturing();
  });
}

/**
 * Person properties — a fixed, reviewed set. No email, no name, no phone: the id is the UUID and
 * these five properties are all that segments a replay.
 *
 * `referral_source` / `utm_source` come from the device's own first-touch storage rather than
 * `/me` (which does not expose them), so they are absent for a master who registered on another
 * device. That is honest: an absent property beats a wrong one.
 *
 * Exported for tests.
 */
export function personProperties(user: UserResponse): Record<string, unknown> {
  const utm = getStoredUtm();
  return {
    plan: user.plan,
    email_verified: user.emailVerified,
    // Master-invented trades are FREE TEXT — «Ремонти від Петра К.» is a perfectly ordinary one,
    // and it can carry a surname or a company. The name never leaves the device; the fact that the
    // master has one folds into the system OTHER it already sits under (V91).
    trades: user.customTrades.length > 0 ? [...new Set([...user.trades, 'OTHER'])] : user.trades,
    referral_source: getStoredRef(),
    utm_source: utm.utmSource,
  };
}

/**
 * The ONE door for a master's analytics state: capturing is gated on their stamped privacy
 * consent, and only a consented master is identified.
 *
 * One function because the two halves must never drift apart — a call site that gates on consent
 * but forgets to identify loses the segmentation, and one that identifies without the gate is a
 * privacy bug. Callers pass `me`; that is all they have to know.
 */
export function applyAnalyticsIdentity(user: UserResponse): void {
  const consented = user.consentedToPrivacyAt != null;
  setAnalyticsConsent(consented);
  if (consented) identifyMaster(user);
}

/** Identify the logged-in master by UUID (never by email). No-op when disabled. */
export function identifyMaster(user: UserResponse): void {
  withClient((ph) => ph.identify(user.id, personProperties(user)));
}

/**
 * Clear the identity on logout — MANDATORY, not hygiene.
 *
 * Without it the next person on the same device is appended to the previous master's person, and
 * their recording is filed under that master. A crew often shares one phone.
 */
export function resetAnalytics(): void {
  withClient((ph) => ph.reset());
}

/** Send one of the events above. No-op when analytics is disabled; never throws. */
export function track<K extends EventName>(event: K, ...args: EventArgs<K>): void {
  const props: Record<string, unknown> | undefined = args[0];
  withClient((ph) => ph.capture(event, props));
}

/** Run something against the SDK once it is loaded, swallowing everything it might throw. */
function withClient(fn: (ph: PostHog) => void): void {
  if (!loading) return;
  void loading
    .then((ph) => {
      if (ph) fn(ph);
    })
    .catch(() => undefined);
}
