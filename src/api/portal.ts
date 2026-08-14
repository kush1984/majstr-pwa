import { api } from './client.ts';
import type { PortalStateResponse } from './types.ts';

/**
 * Owner-side control of the object's SIGNATURE portal (Кошторис tab) — any-status estimates,
 * shown so the client can sign; never has a payments card. `update` publishes the full visible
 * set (everything else is hidden) and mints/reuses the one link; the PWA always calls it before
 * copying or emailing, so the URL matches what the master just ticked. The ECONOMY portal
 * (Економіка tab, SIGNED acts + optional payments card) is a separate link/token — see {@link
 * economyPortalApi}.
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

/**
 * Owner-side control of the object's ECONOMY portal (Економіка tab) — SIGNED acts only, plus an
 * opt-in payments card. Same idempotent publish shape as {@link portalApi}, a separate link/token
 * (a SIGNATURE link can never open this page, or vice versa).
 */
export const economyPortalApi = {
  state(projectId: string): Promise<PortalStateResponse> {
    return api
      .get<PortalStateResponse>(`/api/projects/${projectId}/portal/economy`)
      .then((r) => r.data);
  },

  update(projectId: string, estimateIds: string[], paymentsVisible: boolean): Promise<PortalStateResponse> {
    return api
      .put<PortalStateResponse>(`/api/projects/${projectId}/portal/economy`, { estimateIds, paymentsVisible })
      .then((r) => r.data);
  },

  /** 400 CLIENT_EMAIL_MISSING when the object's client has no email on file. */
  sendEmail(projectId: string): Promise<PortalStateResponse> {
    return api
      .post<PortalStateResponse>(`/api/projects/${projectId}/portal/economy/send-email`)
      .then((r) => r.data);
  },
};
