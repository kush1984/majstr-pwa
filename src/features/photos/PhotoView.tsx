import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from '@/components/Spinner.tsx';
import { photosApi } from '@/api/photos.ts';
import type { ProjectPhotoResponse } from '@/api/types.ts';

/**
 * Shared photo viewers, used by the object «Фото» tab AND the estimate's receipts block.
 * Object photos are served by an authenticated stream (never the public /api/files/**), so a
 * plain <img src> can't carry the bearer token — each tile fetches its blob with the header.
 */

/** Fetches an authenticated photo (bearer token) as a blob object URL, revoking on unmount. */
export function usePhotoBlobUrl(fileUrl: string) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
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

  return { url, failed };
}

/** A thumbnail; tapping it opens the full-screen viewer (no download needed). */
export function AuthPhoto({ fileUrl, alt, onView }: { fileUrl: string; alt: string; onView: () => void }) {
  const { url, failed } = usePhotoBlobUrl(fileUrl);

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
  return (
    <button type="button" onClick={onView} className="block w-full" aria-label={alt}>
      <img src={url} alt={alt} className="aspect-square w-full cursor-zoom-in object-cover" />
    </button>
  );
}

/** Full-screen photo viewer (lightbox). Tap the backdrop / ✕ / Esc to close; arrows or
 *  the on-screen chevrons to move between the photos. Built for phones — 99% of users. */
export function PhotoLightbox({
  list,
  index,
  onIndex,
  onClose,
}: {
  list: ProjectPhotoResponse[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const photo = list[index];
  const { url, failed } = usePhotoBlobUrl(photo.fileUrl);
  const hasPrev = index > 0;
  const hasNext = index < list.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasPrev) onIndex(index - 1);
      else if (e.key === 'ArrowRight' && hasNext) onIndex(index + 1);
    };
    window.addEventListener('keydown', onKey);
    // Lock body scroll while open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [index, hasPrev, hasNext, onClose, onIndex]);

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/90"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-center justify-between p-3 text-white">
        <span className="text-sm text-white/70">
          {index + 1} / {list.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-2xl leading-none"
        >
          ✕
        </button>
      </div>

      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden px-2"
        onClick={(e) => e.stopPropagation()}
      >
        {failed ? (
          <p className="text-white/80">⚠️ {t('photos.loadFailed')}</p>
        ) : !url ? (
          <Spinner />
        ) : (
          <img src={url} alt={photo.caption ?? ''} className="max-h-full max-w-full object-contain" />
        )}

        {hasPrev && (
          <button
            type="button"
            onClick={() => onIndex(index - 1)}
            aria-label={t('photos.prev')}
            className="absolute left-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-3xl leading-none text-white"
          >
            ‹
          </button>
        )}
        {hasNext && (
          <button
            type="button"
            onClick={() => onIndex(index + 1)}
            aria-label={t('photos.next')}
            className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-3xl leading-none text-white"
          >
            ›
          </button>
        )}
      </div>

      {photo.caption && (
        <p className="px-4 pb-4 pt-2 text-center text-sm text-white/80" onClick={(e) => e.stopPropagation()}>
          {photo.caption}
        </p>
      )}
    </div>
  );
}
