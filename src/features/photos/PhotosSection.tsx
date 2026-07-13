import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from '@/components/Spinner.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { UpgradeBanner } from '@/components/UpgradeBanner.tsx';
import { usePlanLimits, isAtLimit } from '@/features/plan/usePlanLimits.ts';
import { photosApi } from '@/api/photos.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { downscaleImage } from '@/lib/image.ts';
import { cn } from '@/lib/cn.ts';
import { usePhotos, useUploadPhoto, useSetPhotoVisibility, useDeletePhoto } from './usePhotos.ts';
import type { ProjectPhotoResponse } from '@/api/types.ts';

const MAX_BYTES = 10 * 1024 * 1024; // pre-check on the original; downscale shrinks it further

/**
 * «Фото» tab: the object's photos. Manual progress photos can be shown to the
 * client (SHARED → they appear on the portal); receipt photos are private and
 * labelled by their estimate. Files come from an authenticated stream, so each
 * tile fetches its blob with the bearer token (`AuthPhoto`).
 */
export function PhotosSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const photos = usePhotos(projectId);
  const upload = useUploadPhoto(projectId);
  const limits = usePlanLimits();
  const fileRef = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<ProjectPhotoResponse | null>(null);
  const del = useDeletePhoto(projectId);

  const manualCount = (photos.data ?? []).filter((p) => p.source === 'MANUAL').length;
  const atPhotoLimit = isAtLimit(manualCount, limits.data?.maxPhotosPerObject);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|webp)$/.test(file.type)) {
      toast.error(t('photos.badType'));
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(t('photos.tooLarge'));
      return;
    }
    const compact = await downscaleImage(file);
    upload.mutate(
      { file: compact, source: 'MANUAL' },
      {
        onSuccess: () => toast.success(t('photos.uploaded')),
        onError: (err) => toast.error(toAppError(err).message),
      },
    );
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await del.mutateAsync(deleting.id);
      setDeleting(null);
      toast.success(t('photos.deleted'));
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const list = photos.data ?? [];

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-bold uppercase tracking-wide text-primary">{t('photos.title')}</h2>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={upload.isPending || atPhotoLimit}
          title={atPhotoLimit ? t('photos.limitReached') : undefined}
          className="text-[13px] font-semibold text-brand disabled:opacity-60"
        >
          {upload.isPending ? t('photos.uploading') : t('photos.add')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            void onPick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {atPhotoLimit && (
        <div className="mb-3">
          <UpgradeBanner text={t('photos.limitHint', { max: limits.data?.maxPhotosPerObject })} trigger="PHOTO_LIMIT" />
        </div>
      )}

      {photos.isPending ? (
        <div className="py-8 text-center">
          <Spinner />
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon="📷" title={t('photos.emptyTitle')} text={t('photos.emptyText')} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {list.map((photo) => (
            <PhotoTile
              key={photo.id}
              projectId={projectId}
              photo={photo}
              onDelete={() => setDeleting(photo)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={t('photos.deleteTitle')}
        message={t('photos.deleteMessage')}
        confirmLabel={t('common.delete')}
        loading={del.isPending}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}

function PhotoTile({
  projectId,
  photo,
  onDelete,
}: {
  projectId: string;
  photo: ProjectPhotoResponse;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const setVisibility = useSetPhotoVisibility(projectId);
  const shared = photo.visibility === 'SHARED';
  const isReceipt = photo.source === 'RECEIPT';

  const toggleShare = () => {
    setVisibility.mutate(
      { photoId: photo.id, visibility: shared ? 'PRIVATE' : 'SHARED' },
      { onError: (err) => toast.error(toAppError(err).message) },
    );
  };

  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <AuthPhoto fileUrl={photo.fileUrl} alt={photo.caption ?? t('photos.title')} />
      <div className="p-2">
        {isReceipt ? (
          <p className="truncate text-[11px] text-muted">
            🧾 {photo.estimateName ? t('photos.receiptOf', { name: photo.estimateName }) : t('photos.receipt')}
          </p>
        ) : (
          <>
            {photo.caption && <p className="truncate text-[11px] text-primary">{photo.caption}</p>}
            <button
              type="button"
              onClick={toggleShare}
              disabled={setVisibility.isPending}
              className={cn(
                'mt-1 w-full rounded-lg px-2 py-1 text-[11px] font-semibold disabled:opacity-60',
                shared ? 'bg-brand-soft text-brand' : 'bg-surface-sunken text-muted',
              )}
            >
              {shared ? t('photos.shownToClient') : t('photos.showToClient')}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onDelete}
          aria-label={t('common.delete')}
          className="mt-1 w-full text-[11px] text-faint hover:text-danger"
        >
          🗑 {t('common.delete')}
        </button>
      </div>
    </div>
  );
}

/** Fetches an authenticated photo as an object URL and renders it, revoking on unmount. */
function AuthPhoto({ fileUrl, alt }: { fileUrl: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    photosApi
      .fetchBlobUrl(fileUrl)
      .then((u) => {
        if (revoked) {
          URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setUrl(u);
      })
      .catch(() => setFailed(true));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileUrl]);

  if (failed) {
    return <div className="flex aspect-square items-center justify-center bg-surface-sunken text-faint">⚠️</div>;
  }
  if (!url) {
    return (
      <div className="flex aspect-square items-center justify-center bg-surface-sunken">
        <Spinner size="sm" />
      </div>
    );
  }
  return <img src={url} alt={alt} className="aspect-square w-full object-cover" />;
}
