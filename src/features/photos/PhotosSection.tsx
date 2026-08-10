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
 * «Фото» tab: two folders — «Фото прогресу» (MANUAL) and «Чеки» (RECEIPT with no estimate link:
 * either uploaded straight here, or orphaned because its estimate was deleted). Either source can
 * be shown to the client (SHARED → appears on the portal, payments-economy-portal iteration lifted
 * the old "receipts always PRIVATE" rule). A receipt tied to an estimate lives under that
 * estimate's Materials section instead — this tab never shows it twice. Files come from an
 * authenticated stream, so each tile fetches its blob with the bearer token (`AuthPhoto`).
 */
export function PhotosSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { online } = useOnlineGuard(); // photo uploads have no offline queue yet
  const photos = usePhotos(projectId);
  const upload = useUploadPhoto(projectId);
  const limits = usePlanLimits();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const receiptFileRef = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<ProjectPhotoResponse | null>(null);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const del = useDeletePhoto(projectId);

  const manualCount = (photos.data ?? []).filter((p) => p.source === 'MANUAL').length;
  const atPhotoLimit = isAtLimit(manualCount, limits.data?.maxPhotosPerObject);
  const receiptCount = (photos.data ?? []).filter((p) => p.source === 'RECEIPT').length;
  const atReceiptLimit = isAtLimit(receiptCount, limits.data?.maxReceiptPhotosPerObject);

  const validateAndDownscale = async (file: File) => {
    if (!online) {
      toast.error(t('offline.needConnection'));
      return null;
    }
    if (!/^image\/(png|jpeg|jpg|webp)$/.test(file.type)) {
      toast.error(t('photos.badType'));
      return null;
    }
    // Size-check AFTER downscaling — a raw camera shot can exceed 10 MB and still
    // compress to a few hundred KB; rejecting it up front would break the
    // take-a-photo-on-site flow on modern phones.
    const compact = await downscaleImage(file);
    if (compact.size > MAX_BYTES) {
      toast.error(t('photos.tooLarge'));
      return null;
    }
    return compact;
  };

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    const compact = await validateAndDownscale(file);
    if (!compact) return;
    upload.mutate(
      { file: compact, source: 'MANUAL' },
      {
        onSuccess: () => toast.success(t('photos.uploaded')),
        onError: (err) => toast.error(toAppError(err).message),
      },
    );
  };

  // No estimateId — lands directly in this tab's «Чеки» folder, for a master who doesn't want to
  // build an estimate for it.
  const onPickReceipt = async (file: File | undefined) => {
    if (!file) return;
    const compact = await validateAndDownscale(file);
    if (!compact) return;
    upload.mutate(
      { file: compact, source: 'RECEIPT' },
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

  const progressPhotos = (photos.data ?? []).filter((p) => p.source === 'MANUAL');
  // A receipt tied to an estimate lives under that estimate's Materials section, not here.
  // Receipts with no estimate (uploaded straight here, or orphaned by an estimate delete) show up.
  const receiptPhotos = (photos.data ?? []).filter((p) => p.source === 'RECEIPT' && p.estimateId === null);
  const list = [...progressPhotos, ...receiptPhotos]; // shared index space for the lightbox

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
      ) : (
        <>
          {progressPhotos.length === 0 ? (
            <EmptyState icon="📷" title={t('photos.emptyTitle')} text={t('photos.emptyText')} />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {progressPhotos.map((photo) => (
                <PhotoTile
                  key={photo.id}
                  projectId={projectId}
                  photo={photo}
                  onView={() => setViewIndex(list.indexOf(photo))}
                  onDelete={() => setDeleting(photo)}
                />
              ))}
            </div>
          )}

          {/* Always reachable — a master's first action on an object may be a receipt,
              not a progress photo, so this folder never hides behind the empty state above. */}
          <div className="mb-2 mt-5 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-muted">🧾 {t('photos.receiptsFolderTitle')}</h3>
            <button
              type="button"
              onClick={() => receiptFileRef.current?.click()}
              disabled={upload.isPending || atReceiptLimit}
              title={atReceiptLimit ? t('photos.limitReached') : undefined}
              className="text-[13px] font-semibold text-brand disabled:opacity-60"
            >
              + {t('photos.addReceipt')}
            </button>
            <input
              ref={receiptFileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                void onPickReceipt(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          {receiptPhotos.length === 0 ? (
            <p className="text-[13px] text-muted">{t('photos.noReceipts')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {receiptPhotos.map((photo) => (
                <PhotoTile
                  key={photo.id}
                  projectId={projectId}
                  photo={photo}
                  onView={() => setViewIndex(list.indexOf(photo))}
                  onDelete={() => setDeleting(photo)}
                />
              ))}
            </div>
          )}
        </>
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
        {isReceipt && (
          <p className="truncate text-[11px] text-muted">
            🧾 {photo.estimateName ? t('photos.receiptOf', { name: photo.estimateName }) : t('photos.receipt')}
          </p>
        )}
        {!isReceipt && photo.caption && <p className="truncate text-[11px] text-primary">{photo.caption}</p>}
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

