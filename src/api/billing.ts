import { api } from './client.ts';

export interface CheckoutResponse {
  /** monobank hosted payment page to redirect to (or the dev return URL when the
   *  backend runs in dev-simulation without a merchant token). */
  pageUrl: string;
}

/** PRO subscription billing (monobank acquiring). */
export const billingApi = {
  /** Start a PRO checkout. `autoRenew` opts into card tokenization + auto-renewal. */
  checkout(autoRenew: boolean): Promise<CheckoutResponse> {
    return api.post<CheckoutResponse>('/api/billing/checkout', { autoRenew }).then((r) => r.data);
  },
};
