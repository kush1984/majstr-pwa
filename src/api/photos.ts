import { api, ensureAccessToken } from './client.ts';
import { config } from '@/lib/config.ts';
import type { PhotoSource, PhotoVisibility, ProjectPhotoResponse } from './types.ts';

/**
 * Object photos («Фото» tab). Files are served by an authenticated stream (never
 * the public /api/files/**), so a plain <img src> can't carry the bearer token —
 * `fetchBlobUrl` fetches the bytes with the Authorization header and returns an
 * object URL (the caller revokes it), mirroring `estimatesApi.fetchPdf`.
 */
export const photosApi = {
  list(projectId: string): Promise<ProjectPhotoResponse[]> {
    return api
      .get<ProjectPhotoResponse[]>(`/api/projects/${projectId}/photos`)
      .then((r) => r.data);
  },

  upload(
    projectId: string,
    file: File,
    opts: { source: PhotoSource; caption?: string; estimateId?: string },
  ): Promise<ProjectPhotoResponse> {
    const form = new FormData();
    form.append('file', file);
    form.append('source', opts.source);
    if (opts.caption) form.append('caption', opts.caption);
    if (opts.estimateId) form.append('estimateId', opts.estimateId);
    return api
      .post<ProjectPhotoResponse>(`/api/projects/${projectId}/photos`, form, {
        headers: { 'Content-Type': undefined } as unknown as Record<string, string>,
      })
      .then((r) => r.data);
  },

  setVisibility(
    projectId: string,
    photoId: string,
    visibility: PhotoVisibility,
  ): Promise<ProjectPhotoResponse> {
    return api
      .patch<ProjectPhotoResponse>(`/api/projects/${projectId}/photos/${photoId}`, { visibility })
      .then((r) => r.data);
  },

  remove(projectId: string, photoId: string): Promise<void> {
    return api.delete(`/api/projects/${projectId}/photos/${photoId}`).then(() => undefined);
  },

  /** Fetch an authenticated photo file as an object URL (caller revokes it). */
  async fetchBlobUrl(fileUrl: string): Promise<string> {
    const access = await ensureAccessToken();
    const resp = await fetch(`${config.apiBaseUrl}${fileUrl}`, {
      headers: { Authorization: `Bearer ${access ?? ''}` },
    });
    if (!resp.ok) throw new Error(`Photo request failed: ${resp.status}`);
    const blob = await resp.blob();
    return URL.createObjectURL(blob);
  },
};
