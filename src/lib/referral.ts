/**
 * First-touch referral capture. A ?ref=<code> on any entry (or the /liga alias)
 * is stored ONCE in localStorage and sent with registration, so a master who
 * arrived via a partner is attributed even if they wander the site before signing
 * up. First-touch: an existing value is never overwritten by a later ref.
 */
const REF_KEY = 'majstr.ref';

/** Store a ref code first-touch (ignored if one is already stored). */
export function storeRef(code: string | null | undefined): void {
  try {
    const value = (code ?? '').trim();
    if (value && !localStorage.getItem(REF_KEY)) {
      localStorage.setItem(REF_KEY, value.slice(0, 40));
    }
  } catch {
    /* private mode / storage disabled — attribution is best-effort */
  }
}

/** Capture ?ref= from a URL query string (call once on app boot). */
export function captureRefFromUrl(search: string): void {
  try {
    storeRef(new URLSearchParams(search).get('ref'));
  } catch {
    /* ignore malformed query */
  }
}

/** The stored ref code, or undefined — attach to the registration payload. */
export function getStoredRef(): string | undefined {
  try {
    return localStorage.getItem(REF_KEY) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * First-touch UTM capture — the CHANNEL the master arrived through (TikTok, a Telegram post, an
 * article), stored under its own key next to the ref above.
 *
 * Why not one value with the ref: `ref` is a PARTNER (money, rev-share, the backend `partners`
 * registry), UTM is a channel. A master can follow Ліга Майстрів' partner link FROM TikTok —
 * folded into one field, one of the two dimensions is lost.
 *
 * Same first-touch law as the ref: written once, never overwritten by a later visit. All three tags
 * are stored TOGETHER as one entry, so a second campaign link cannot half-overwrite the first one
 * (a medium from one campaign glued to another campaign's source describes nothing that happened).
 */
const UTM_KEY = 'majstr.utm';

/** The three first-touch UTM tags; every one optional — absent means "arrived with no tags". */
export interface UtmTags {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

const clean = (value: string | null): string | undefined => {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed.slice(0, 60) : undefined;
};

/** Capture utm_source/utm_medium/utm_campaign from a URL query (call once on app boot). */
export function captureUtmFromUrl(search: string): void {
  try {
    if (localStorage.getItem(UTM_KEY)) return; // first-touch wins
    const params = new URLSearchParams(search);
    const tags: UtmTags = {
      utmSource: clean(params.get('utm_source')),
      utmMedium: clean(params.get('utm_medium')),
      utmCampaign: clean(params.get('utm_campaign')),
    };
    // Nothing to remember unless at least one tag is present — storing an empty object would
    // claim first touch and lock out the campaign link the master actually clicks tomorrow.
    if (!tags.utmSource && !tags.utmMedium && !tags.utmCampaign) return;
    localStorage.setItem(UTM_KEY, JSON.stringify(tags));
  } catch {
    /* private mode / malformed query — attribution is best-effort */
  }
}

/** The stored tags, or an empty object — spread into the registration payload. */
export function getStoredUtm(): UtmTags {
  try {
    const raw = localStorage.getItem(UTM_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const { utmSource, utmMedium, utmCampaign } = parsed as UtmTags;
    return { utmSource, utmMedium, utmCampaign };
  } catch {
    return {};
  }
}
