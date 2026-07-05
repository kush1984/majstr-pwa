import { api } from './client.ts';
import type { BillingPeriod, ReferralStatsResponse } from './types.ts';

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

  /** Master→master referral stats for the "Запроси майстра" profile panel. */
  referralStats(): Promise<ReferralStatsResponse> {
    return api.get<ReferralStatsResponse>('/api/referrals/me').then((r) => r.data);
  },
};
