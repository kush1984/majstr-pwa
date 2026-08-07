import { api } from './client.ts';
import type { ProfileUpdateRequest, UserResponse } from './types.ts';

interface CustomTradeRequest {
  name: string;
}

/** Contractor profile editing (#16) + company logo (multipart) for branded
 *  PDFs (PRO) and the client portal (all plans). */
export const profileApi = {
  update(req: ProfileUpdateRequest): Promise<UserResponse> {
    return api.put<UserResponse>('/api/profile', req).then((r) => r.data);
  },

  /**
   * Upload the company logo (PNG/JPEG, ≤2 MB enforced by the backend). Returns
   * the updated user (with `logoUrl`). We send FormData and **unset the JSON
   * Content-Type** the shared axios instance forces, so the browser sets
   * `multipart/form-data` *with the boundary* — keeping the instance still
   * attaches the bearer + proactive-refresh.
   */
  uploadLogo(file: File): Promise<UserResponse> {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<UserResponse>('/api/profile/logo', form, {
        // `undefined` removes the header so the browser sets the multipart
        // boundary; axios types don't allow undefined here, hence the cast.
        headers: { 'Content-Type': undefined } as unknown as Record<string, string>,
      })
      .then((r) => r.data);
  },

  deleteLogo(): Promise<void> {
    return api.delete('/api/profile/logo').then(() => undefined);
  },

  /** Record privacy-policy consent (one-time login modal for pre-existing users). */
  consent(): Promise<UserResponse> {
    return api.post<UserResponse>('/api/profile/consent').then((r) => r.data);
  },

  /** Acknowledge responsibility for entering client data (shown once). */
  acknowledgeClientData(): Promise<UserResponse> {
    return api.post<UserResponse>('/api/profile/acknowledge-client-data').then((r) => r.data);
  },

  /** Toggle subscription auto-renewal. Disabling is instant; enabling needs a saved card. */
  setAutoRenew(enabled: boolean): Promise<UserResponse> {
    return api
      .patch<UserResponse>(`/api/profile/auto-renew?enabled=${enabled}`)
      .then((r) => r.data);
  },

  /** Add a master-invented trade — no reference catalog exists for it. */
  addCustomTrade(name: string): Promise<UserResponse> {
    return api
      .post<UserResponse>('/api/profile/custom-trades', { name } satisfies CustomTradeRequest)
      .then((r) => r.data);
  },

  /** Rename a custom trade — a live FK, every position/template filed under it updates at once. */
  renameCustomTrade(id: string, name: string): Promise<UserResponse> {
    return api
      .patch<UserResponse>(`/api/profile/custom-trades/${id}`, { name } satisfies CustomTradeRequest)
      .then((r) => r.data);
  },

  /** Delete a custom trade — positions/templates filed under it fall back to "Інше". */
  deleteCustomTrade(id: string): Promise<UserResponse> {
    return api.delete<UserResponse>(`/api/profile/custom-trades/${id}`).then((r) => r.data);
  },
};
