import { isHandheld } from '@/lib/deviceInput.ts';

/**
 * Should a share sheet lead with the system share (Viber / Telegram / SMS) instead of «Копіювати»?
 * Only on a phone: desktop Chrome on Windows has `navigator.share` too, but there the master wants
 * the link in his clipboard, as before (review P1-8).
 */
export function canShareNatively(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && isHandheld();
}

/**
 * Hands the link to the system share sheet.
 * - `shared` — the master picked a target;
 * - `cancelled` — he closed the sheet (AbortError): nothing left the phone, so nothing is marked sent;
 * - `blocked` — the browser refused (the tap's activation was spent by an await, or no share at all):
 *   the caller shows the link and lets him tap again.
 */
export async function shareNatively(url: string, text: string): Promise<'shared' | 'cancelled' | 'blocked'> {
  try {
    await navigator.share({ url, text });
    return 'shared';
  } catch (err) {
    return err instanceof DOMException && err.name === 'AbortError' ? 'cancelled' : 'blocked';
  }
}
