import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from '@/components/Spinner.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { UpgradeBanner } from '@/components/UpgradeBanner.tsx';
import { usePlanLimits, isAtLimit } from '@/features/plan/usePlanLimits.ts';
import { toast } from '@/hooks/useToast.ts';
import { useOnlineGuard } from '@/hooks/useOnlineGuard.ts';
import { toAppError } from '@/api/errors.ts';
import { downscaleImage } from '@/lib/image.ts';
import { cn } from '@/lib/cn.ts';
import { usePhotos, useUploadPhoto, useSetPhotoVisibility, useDeletePhoto } from './usePhotos.ts';
import { AuthPhoto, PhotoLightbox } from './PhotoView.tsx';
import type { ProjectPhotoResponse } from '@/api/types.ts';

const MAX_BYTES = 10 * 1024 * 1024; // pre-check on the original; downscale shrinks it further

/** Touch = a device that plausibly has a camera; a desktop file dialog ignores `capture` anyway. */
const canCapture = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;

/**
 * «Фото» tab: the object's photos. Manual progress photos can be shown to the
 * client (SHARED → they appear on the portal); receipt photos are private and
 * labelled by their estimate. Files come from an authenticated stream, so each
 * tile fetches its blob with the bearer token (`AuthPhoto`).
 */
export function PhotosSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { online } = useOnlineGuard(); // photo uploads have no offline queue yet
  const photos = usePhotos(projectId);
  const upload = useUploadPhoto(projectId);
  const limits = usePlanLimits();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<ProjectPhotoResponse | null>(null);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const del = useDeletePhoto(projectId);

  const manualCount = (photos.data ?? []).filter((p) => p.source === 'MANUAL').length;
  const atPhotoLimit = isAtLimit(manualCount, limits.data?.maxPhotosPerObject);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    // A photo upload streams to the server — there's no offline queue for blobs yet, so tell the
    // master plainly instead of letting the upload fail with a network error.
    if (!online) {
      toast.error(t('offline.needConnection'));
      return;
    }
    if (!/^image\/(png|jpeg|jpg|webp)$/.test(file.type)) {
      toast.error(t('photos.badType'));
      return;
    }
    // Size-check AFTER downscaling — a raw camera shot can exceed 10 MB and still
    // compress to a few hundred KB; rejecting it up front would break the
    // take-a-photo-on-site flow on modern phones.
    const compact = await downscaleImage(file);
    if (compact.size > MAX_BYTES) {
      toast.error(t('photos.tooLarge'));
      return;
    }
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

  // A receipt tied to an estimate now lives under that estimate's Materials section, not here — the
  // «Фото» tab is for object/progress photos. Receipts with no estimate (its estimate was deleted →
  // estimateId set null) stay visible here so they can't be orphaned out of reach.
  const list = (photos.data ?? []).filter((p) => p.source !== 'RECEIPT' || p.estimateId === null);

  return (
    <section>
      {/* Two explicit paths: `capture` guarantees the camera opens on the object; a plain
          picker with a concrete MIME list often shows no camera option on Android. On a
          desktop (no touch) the camera button is meaningless — gallery goes full-width. */}
      <div className={cn('mb-3 grid gap-2', canCapture ? 'grid-cols-2' : 'grid-cols-1')}>
        {canCapture && (
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            disabled={upload.isPending || atPhotoLimit}
            title={atPhotoLimit ? t('photos.limitReached') : undefined}
            className="min-h-[44px] rounded-xl border border-border bg-surface px-3 text-[13px] font-semibold text-brand disabled:opacity-60"
          >
            📷 {t('photos.takePhoto')}
          </button>
        )}
        <button
          type="button"
          onClick={() => galleryRef.current?.click()}
          disabled={upload.isPending || atPhotoLimit}
          title={atPhotoLimit ? t('photos.limitReached') : undefined}
          className="min-h-[44px] rounded-xl border border-border bg-surface px-3 text-[13px] font-semibold text-brand disabled:opacity-60"
        >
          {upload.isPending
            ? t('photos.uploading')
            : <>🖼 {canCapture ? t('photos.fromGallery') : t('photos.addFile')}</>}
        </button>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            void onPick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <input
          ref={galleryRef}
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
          {list.map((photo, i) => (
            <PhotoTile
              key={photo.id}
              projectId={projectId}
              photo={photo}
              onView={() => setViewIndex(i)}
              onDelete={() => setDeleting(photo)}
            />
          ))}
        </div>
      )}

      {viewIndex !== null && list[viewIndex] && (
        <PhotoLightbox
          list={list}
          index={viewIndex}
          onIndex={setViewIndex}
          onClose={() => setViewIndex(null)}
        />
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
  onView,
  onDelete,
}: {
  projectId: string;
  photo: ProjectPhotoResponse;
  onView: () => void;
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
      <AuthPhoto fileUrl={photo.fileUrl} alt={photo.caption ?? t('photos.title')} onView={onView} />
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

