import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { photosApi } from '@/api/photos.ts';
import type { PhotoSource, PhotoVisibility } from '@/api/types.ts';

/** Exported so the offline prefetch primes the SAME key this hook reads. */
export const PHOTOS_KEY = (projectId: string) => ['project-photos', projectId] as const;
const key = PHOTOS_KEY;

/** The object's photos (owner). PHOTO_REPORTS is granted to all plans, so no gate here. */
export function usePhotos(projectId: string, enabled = true) {
  return useQuery({
    queryKey: key(projectId),
    queryFn: () => photosApi.list(projectId),
    enabled: Boolean(projectId) && enabled,
  });
}

export function useUploadPhoto(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { file: File; source: PhotoSource; caption?: string; estimateId?: string }) =>
      photosApi.upload(projectId, vars.file, {
        source: vars.source,
        caption: vars.caption,
        estimateId: vars.estimateId,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
  });
}

export function useSetPhotoVisibility(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { photoId: string; visibility: PhotoVisibility }) =>
      photosApi.setVisibility(projectId, vars.photoId, vars.visibility),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
  });
}

export function useDeletePhoto(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) => photosApi.remove(projectId, photoId),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
  });
}
