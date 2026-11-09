import { useEffect, useRef } from 'react';
import type { Trade, UserResponse } from '@/api/types.ts';
import { toAppError } from '@/api/errors.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { useAddCustomTrade, useUpdateTrades } from '@/features/profile/useProfile.ts';
import { useOnline } from '@/lib/useOnline.ts';

/** The answer given with no connection, waiting to reach the server. */
export interface PendingTradesAnswer {
  trades: Trade[];
  customNames: string[];
}

/** 1.72.0 kept a skip here as `'1'`, on the device only; the same key now holds any unsent answer. */
const PENDING = (userId: string) => `majstr.tradesSkipped.${userId}`;

export function pendingTradesAnswer(userId: string): PendingTradesAnswer | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(PENDING(userId));
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingTradesAnswer> | null;
    return {
      trades: Array.isArray(parsed?.trades) ? parsed.trades : [],
      customNames: Array.isArray(parsed?.customNames) ? parsed.customNames : [],
    };
  } catch {
    return { trades: [], customNames: [] };
  }
}

export function rememberTradesAnswer(userId: string, answer: PendingTradesAnswer): void {
  try {
    localStorage.setItem(PENDING(userId), JSON.stringify(answer));
  } catch {
    // Blocked storage: the screen asks again next time, which is all a lost answer costs.
  }
}

function forgetTradesAnswer(userId: string): void {
  try {
    localStorage.removeItem(PENDING(userId));
  } catch {
    // Nothing kept, nothing to forget.
  }
}

/** No answer has reached the server yet. */
function unanswered(me: UserResponse): boolean {
  return !me.tradesOnboardedAt && me.trades.length === 0 && me.customTrades.length === 0;
}

/**
 * «Чим займаєтесь?» after registration (registration friction round 2, V190).
 *
 * <p>The answer — trades picked, or a skip — is the SERVER's (`tradesOnboardedAt`, V193): the skip
 * used to live in localStorage, so the screen came back on every other phone, and a master who later
 * unticked every trade in his profile was sent to it again. A master who already has a trade is never
 * asked, whatever a cache says about the stamp (a `me` cached before V193 carries none). An answer
 * given offline counts too: the screen must never hold a master in a basement out of his app.</p>
 */
export function needsTradesScreen(me: UserResponse): boolean {
  return unanswered(me) && pendingTradesAnswer(me.id) === null;
}

/**
 * Sends an answer given offline — or a 1.72.0 skip the server never heard of — once there is a
 * connection. An answer that reached the server some other way (another phone) wins; only the custom
 * trades not there yet are still added.
 */
export function useTradesAnswerSync(): void {
  const { data: me } = useMe();
  const online = useOnline();
  const { mutateAsync: updateTrades } = useUpdateTrades();
  const { mutateAsync: addCustomTrade } = useAddCustomTrade();
  const sending = useRef(false);

  useEffect(() => {
    if (!me || !online || sending.current) return;
    const pending = pendingTradesAnswer(me.id);
    if (!pending) return;
    sending.current = true;
    const send = async () => {
      if (unanswered(me)) await updateTrades({ trades: pending.trades });
      const known = me.customTrades.map((c) => c.name.toLowerCase());
      for (const name of pending.customNames.filter((n) => !known.includes(n.toLowerCase()))) {
        try {
          await addCustomTrade(name);
        } catch (err) {
          if (toAppError(err).status !== 409) throw err;
        }
      }
    };
    send()
      .then(() => forgetTradesAnswer(me.id))
      .catch((err: unknown) => {
        // No answer, or the server failing: kept for the next connection. A refusal would refuse
        // again, so it is dropped — the screen then asks once more.
        const status = toAppError(err).status;
        if (status !== undefined && status < 500) forgetTradesAnswer(me.id);
      })
      .finally(() => { sending.current = false; });
  }, [me, online, updateTrades, addCustomTrade]);
}
