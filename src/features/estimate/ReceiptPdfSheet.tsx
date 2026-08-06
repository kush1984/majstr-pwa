import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { AuthPhoto } from '@/features/photos/PhotoView.tsx';
import { cn } from '@/lib/cn.ts';
import type { ProjectPhotoResponse } from '@/api/types.ts';

/**
 * Asked when a master generates the PDF for an estimate that has photos to attach: which to append
 * as the «ЧЕКИ» section at the end. Two groups:
 *  - «Чеки» — receipts linked to this estimate, selected by default (the common answer is "all").
 *  - «Інші фото обʼєкта» — the object's progress photos, OFF by default, for the case where a
 *    receipt got saved as an ordinary photo and the master wants it on the PDF anyway.
 * A thumbnail grid with a check on each is the phone-friendly way to pick from many. Mounted only
 * while open, so the default selection re-seeds every time it's opened.
 */
export function ReceiptPdfSheet({
  receipts,
  otherPhotos,
  downloading,
  onConfirm,
  onClose,
}: {
  receipts: ProjectPhotoResponse[];
  otherPhotos: ProjectPhotoResponse[];
  downloading: boolean;
  onConfirm: (photoIds: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // Default: the linked receipts only. Other object photos start unchecked.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(receipts.map((r) => r.id)));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const total = receipts.length + otherPhotos.length;
  const allSelected = selected.size === total;
  const setAll = (on: boolean) =>
    setSelected(on ? new Set([...receipts, ...otherPhotos].map((p) => p.id)) : new Set());

  return (
    <Modal open onClose={onClose} size="lg" title={t('estimate.pdfReceiptsTitle')}>
      <p className="mb-3 text-sm text-muted">{t('estimate.pdfReceiptsHint')}</p>

      {total > 1 && (
        <button
          type="button"
          onClick={() => setAll(!allSelected)}
          className="mb-2 text-sm font-semibold text-brand"
        >
          {allSelected ? t('estimate.pdfClearAll') : t('estimate.pdfSelectAll')}
        </button>
      )}

      <div className="max-h-[45dvh] space-y-4 overflow-y-auto">
        {receipts.length > 0 && (
          <PhotoPickGrid heading={t('estimate.receipts')} photos={receipts} selected={selected} onToggle={toggle} />
        )}
        {otherPhotos.length > 0 && (
          <PhotoPickGrid
            heading={t('estimate.pdfOtherPhotos')}
            photos={otherPhotos}
            selected={selected}
            onToggle={toggle}
          />
        )}
      </div>

      <div className="mt-4">
        <Button fullWidth loading={downloading} onClick={() => onConfirm([...selected])}>
          {selected.size > 0
            ? t('estimate.pdfDownloadWithReceipts', { count: selected.size })
            : t('estimate.pdfDownloadNoReceipts')}
        </Button>
      </div>
    </Modal>
  );
}

function PhotoPickGrid({
  heading,
  photos,
  selected,
  onToggle,
}: {
  heading: string;
  photos: ProjectPhotoResponse[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">{heading}</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((p) => {
          const checked = selected.has(p.id);
          return (
            <div
              key={p.id}
              className={cn(
                'relative overflow-hidden rounded-card border-2 transition-colors',
                checked ? 'border-brand' : 'border-border',
              )}
            >
              <AuthPhoto fileUrl={p.fileUrl} alt={t('photos.receipt')} onView={() => onToggle(p.id)} />
              <span
                aria-hidden
                className={cn(
                  'pointer-events-none absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-md border text-xs',
                  checked ? 'border-brand bg-brand text-white' : 'border-white/70 bg-black/30 text-transparent',
                )}
              >
                ✓
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
