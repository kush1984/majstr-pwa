import type { UserResponse } from '@/api/types.ts';

/**
 * «Чим займаєтесь?» after registration (registration friction round 2, V190).
 *
 * The register form stopped asking for trades; this screen asks right after, inside the app, and may
 * be skipped. A skip is remembered per account on this device only — on another phone the screen
 * comes back once, which is harmless: the real safety net is the empty template picker, which says
 * what is missing and leads here (`TemplatePickerSheet`).
 */
const SKIPPED = (userId: string) => `majstr.tradesSkipped.${userId}`;

/** A master with no system trade and no custom one who has not said «пропустити» on this device. */
export function needsTradesScreen(me: UserResponse): boolean {
  return me.trades.length === 0 && me.customTrades.length === 0 && !wasSkipped(me.id);
}

export function markTradesSkipped(userId: string): void {
  try {
    localStorage.setItem(SKIPPED(userId), '1');
  } catch {
    // Private mode / blocked storage: the screen just shows again next time.
  }
}

function wasSkipped(userId: string): boolean {
  try {
    return localStorage.getItem(SKIPPED(userId)) === '1';
  } catch {
    return false;
  }
}
