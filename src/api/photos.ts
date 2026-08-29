import { api, ensureAccessToken } from './client.ts';
import { config } from '@/lib/config.ts';
import type { PhotoSource, PhotoVisibility, ProjectPhotoFolderResponse, ProjectPhotoResponse } from './types.ts';

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
    opts: { source: PhotoSource; caption?: string; estimateId?: string; folder?: string | null },
  ): Promise<ProjectPhotoResponse> {
    const form = new FormData();
    form.append('file', file);
    form.append('source', opts.source);
    if (opts.caption) form.append('caption', opts.caption);
    if (opts.estimateId) form.append('estimateId', opts.estimateId);
    // Sent whenever the caller knows the target folder — '' is «Інше», not "unset". Omitting it
    // entirely leaves the server's per-source default (RECEIPT → «Чеки», else «Інше»).
    if (opts.folder !== undefined) form.append('folder', opts.folder ?? '');
    return api
      .post<ProjectPhotoResponse>(`/api/projects/${projectId}/photos`, form, {
        headers: { 'Content-Type': undefined } as unknown as Record<string, string>,
      })
      .then((r) => r.data);
  },

  listFolders(projectId: string): Promise<ProjectPhotoFolderResponse[]> {
    return api
      .get<ProjectPhotoFolderResponse[]>(`/api/projects/${projectId}/photos/folders`)
      .then((r) => r.data);
  },

  /** Create an EMPTY custom folder ahead of its photos. Idempotent on the name. */
  createFolder(projectId: string, name: string): Promise<ProjectPhotoFolderResponse> {
    return api
      .post<ProjectPhotoFolderResponse>(`/api/projects/${projectId}/photos/folders`, { folder: name })
      .then((r) => r.data);
  },

  /** Delete a custom folder — the server refuses while any photo carries its name. */
  removeFolder(projectId: string, folderId: string): Promise<void> {
    return api.delete(`/api/projects/${projectId}/photos/folders/${folderId}`).then(() => undefined);
  },

  /** Move a photo between folders: 'RECEIPTS' = «Чеки», null = «Інше», else a custom name. */
  setFolder(projectId: string, photoId: string, folder: string | null): Promise<ProjectPhotoResponse> {
    return api
      .patch<ProjectPhotoResponse>(`/api/projects/${projectId}/photos/${photoId}/folder`, { folder })
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

  /** The raw bytes behind an authenticated photo endpoint — the receipt card re-reads its own
   *  stored photo from here to try the fiscal QR again, for free, before spending a model call. */
  async fetchBlob(fileUrl: string): Promise<Blob> {
    const access = await ensureAccessToken();
    const resp = await fetch(`${config.apiBaseUrl}${fileUrl}`, {
      headers: { Authorization: `Bearer ${access ?? ''}` },
    });
    if (!resp.ok) throw new Error(`Photo request failed: ${resp.status}`);
    return resp.blob();
  },

  /** The same bytes as an object URL (caller revokes it). */
  async fetchBlobUrl(fileUrl: string): Promise<string> {
    return URL.createObjectURL(await photosApi.fetchBlob(fileUrl));
  },
};
