import { api } from './client.ts';
import type { PortalStateResponse } from './types.ts';

/**
 * Owner-side control of the object's client portal. `update` publishes the
 * full visible set (everything else is hidden) and mints/reuses the one link;
 * the PWA always calls it before copying or emailing, so the URL matches what
 * the master just ticked.
 */
export const portalApi = {
  state(projectId: string): Promise<PortalStateResponse> {
    return api
      .get<PortalStateResponse>(`/api/projects/${projectId}/portal`)
      .then((r) => r.data);
  },

  update(projectId: string, estimateIds: string[]): Promise<PortalStateResponse> {
    return api
      .put<PortalStateResponse>(`/api/projects/${projectId}/portal`, { estimateIds })
      .then((r) => r.data);
  },

  /** 400 CLIENT_EMAIL_MISSING when the object's client has no email on file. */
  sendEmail(projectId: string): Promise<PortalStateResponse> {
    return api
      .post<PortalStateResponse>(`/api/projects/${projectId}/portal/send-email`)
      .then((r) => r.data);
  },
};
