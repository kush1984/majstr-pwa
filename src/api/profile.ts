import { api } from './client.ts';
import type { ProfileUpdateRequest, UserResponse } from './types.ts';

/** Contractor profile editing (#16). Logo upload lives on the backend's
 *  ProfileController too (multipart) but isn't wired in the UI yet. */
export const profileApi = {
  update(req: ProfileUpdateRequest): Promise<UserResponse> {
    return api.put<UserResponse>('/api/profile', req).then((r) => r.data);
  },
};
