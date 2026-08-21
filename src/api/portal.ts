import { api } from './client.ts';
import type { ActShareStateResponse, PortalStateResponse, ShareLinkResponse } from './types.ts';

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

/**
 * ONE estimate's own share link (`?t=`) — what "поділитися" from the estimate editor mints. Unlike
 * {@link portalApi}/{@link economyPortalApi}, which publish a SET onto the object's single link,
 * this link points at exactly one estimate and is independent of them: minting it neither shows
 * nor hides anything on the object's portal. `create` is idempotent — the same estimate hands
 * back the same URL until that link is revoked or expires.
 */
export const estimateShareApi = {
  create(estimateId: string): Promise<ShareLinkResponse> {
    return api.post<ShareLinkResponse>(`/api/estimates/${estimateId}/share`).then((r) => r.data);
  },

  /** 400 CLIENT_EMAIL_MISSING when the object's client has no email on file. */
  sendEmail(estimateId: string): Promise<ShareLinkResponse> {
    return api
      .post<ShareLinkResponse>(`/api/estimates/${estimateId}/share/send-email`)
      .then((r) => r.data);
  },
};

/**
 * Owner-side control of ONE act's client share link (acts iteration, prompt 5). Unlike the
 * set-based portal/economy links, an act link points at a single document: `publish` flips a DRAFT
 * act to SENT and mints/reuses its link (the client can then sign it), `sendEmail` mails that link.
 */
export const actPortalApi = {
  state(actId: string): Promise<ActShareStateResponse> {
    return api.get<ActShareStateResponse>(`/api/acts/${actId}/share`).then((r) => r.data);
  },

  publish(actId: string): Promise<ActShareStateResponse> {
    return api.put<ActShareStateResponse>(`/api/acts/${actId}/share`).then((r) => r.data);
  },

  /** 400 CLIENT_EMAIL_MISSING when the object's client has no email on file. */
  sendEmail(actId: string): Promise<ActShareStateResponse> {
    return api.post<ActShareStateResponse>(`/api/acts/${actId}/share/send-email`).then((r) => r.data);
  },
};
