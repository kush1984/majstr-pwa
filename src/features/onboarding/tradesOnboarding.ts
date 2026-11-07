import type { UserResponse } from '@/api/types.ts';

/**
 * «Чим займаєтесь?» after registration (registration friction round 2, V190).
 *
 * <p>The answer — trades picked, or a skip — is the SERVER's (`tradesOnboardedAt`, V193): the skip
 * used to live in localStorage, so the screen came back on every other phone, and a master who later
 * unticked every trade in his profile was sent to it again. A master who already has a trade is never
 * asked, whatever a cache says about the stamp (a `me` cached before V193 carries none).</p>
 */
export function needsTradesScreen(me: UserResponse): boolean {
  return !me.tradesOnboardedAt && me.trades.length === 0 && me.customTrades.length === 0;
}
