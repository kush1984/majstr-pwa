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
