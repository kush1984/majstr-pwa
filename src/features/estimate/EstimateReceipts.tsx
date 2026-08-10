import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { cn } from '@/lib/cn.ts';
import { usePhotos, useDeletePhoto, useSetPhotoVisibility } from '@/features/photos/usePhotos.ts';
import { AuthPhoto, PhotoLightbox } from '@/features/photos/PhotoView.tsx';
import type { ProjectPhotoResponse } from '@/api/types.ts';

/**
 * Receipts attached to THIS estimate, shown directly under the Materials section of the editor —
 * a receipt belongs to the estimate whose materials it paid for, not to the object's general «Фото»
 * tab. A receipt is a private project photo (source RECEIPT) linked to the estimate by id.
 *
 * It renders even when the estimate has no material lines: a master may snap a receipt and keep it
 * without moving its positions into the estimate, and that receipt must still have a home. When
 * there are none, the block is absent entirely (no empty heading).
 */
export function EstimateReceipts({
  projectId,
  estimateId,
  sourceEstimateIds = [],
  signed,
}: {
  projectId: string;
  estimateId: string;
  /** For a consolidated estimate: its source estimates, whose receipts are shown here too. */
  sourceEstimateIds?: string[];
  signed: boolean;
}) {
  const { t } = useTranslation();
  const photos = usePhotos(projectId);
  const del = useDeletePhoto(projectId);
  const setVisibility = useSetPhotoVisibility(projectId);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<ProjectPhotoResponse | null>(null);

  const estimateIds = new Set([estimateId, ...sourceEstimateIds]);
  const receipts = (photos.data ?? []).filter(
    (p) => p.source === 'RECEIPT' && p.estimateId !== null && estimateIds.has(p.estimateId),
  );
  if (receipts.length === 0) return null;

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

  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center justify-between border-b border-border pb-1.5">
        <span className="text-sm font-extrabold uppercase tracking-wide text-primary">
          🧾 {t('estimate.receipts')}
        </span>
        <span className="text-sm font-bold text-muted">{receipts.length}</span>
      </div>
      {/* Thumbnails, three across on a phone — a receipt is a reference the master glances at, not
          the estimate's content, so it reads smaller than a position card. */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {receipts.map((photo, i) => {
          const shared = photo.visibility === 'SHARED';
          return (
            <div key={photo.id} className="overflow-hidden rounded-card border border-border bg-surface">
              <AuthPhoto fileUrl={photo.fileUrl} alt={t('photos.receipt')} onView={() => setViewIndex(i)} />
              <button
                type="button"
                onClick={() =>
                  setVisibility.mutate(
                    { photoId: photo.id, visibility: shared ? 'PRIVATE' : 'SHARED' },
                    { onError: (err) => toast.error(toAppError(err).message) },
                  )
                }
                disabled={setVisibility.isPending}
                className={cn(
                  'w-full px-1 py-1 text-[10px] font-semibold leading-tight disabled:opacity-60',
                  shared ? 'bg-brand-soft text-brand' : 'bg-surface-sunken text-muted',
                )}
              >
                {shared ? t('photos.shownToClient') : t('photos.showToClient')}
              </button>
              {!signed && (
                <button
                  type="button"
                  onClick={() => setDeleting(photo)}
                  aria-label={t('common.delete')}
                  className="w-full py-1 text-[11px] text-faint hover:text-danger"
                >
                  🗑
                </button>
              )}
            </div>
          );
        })}
      </div>

      {viewIndex !== null && receipts[viewIndex] && (
        <PhotoLightbox
          list={receipts}
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
