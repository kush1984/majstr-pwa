import { api } from './client.ts';
import type { BillingPeriod, ReferralStatsResponse, UserResponse } from './types.ts';

export interface CheckoutResponse {
  /** monobank hosted payment page to redirect to (or the dev return URL when the
   *  backend runs in dev-simulation without a merchant token). */
  pageUrl: string;
}

/** PRO subscription billing (monobank acquiring). */
export const billingApi = {
  /**
   * Start a PRO checkout. `period` picks the tariff (the server owns the amount —
   * the client never sends a price); `autoRenew` opts into card tokenization +
   * auto-renewal (recharged for the same period).
   */
  checkout(period: BillingPeriod, autoRenew: boolean): Promise<CheckoutResponse> {
    return api
      .post<CheckoutResponse>('/api/billing/checkout', { period, autoRenew })
      .then((r) => r.data);
  },

  /**
   * Activate the one-time self-serve 5-day PRO trial (FREE only, no card).
   * Returns the updated profile; the caller refreshes `me`. 409 TRIAL_UNAVAILABLE
   * if already used or not on FREE.
   */
  startTrial(): Promise<UserResponse> {
    return api.post<UserResponse>('/api/billing/trial').then((r) => r.data);
  },

  /** Master→master referral stats for the "Запроси майстра" profile panel. */
  referralStats(): Promise<ReferralStatsResponse> {
    return api.get<ReferralStatsResponse>('/api/referrals/me').then((r) => r.data);
  },
};
