import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { photosApi } from '@/api/photos.ts';

/**
 * Where a receipt's photo lives at the moment it is shown. The two screens that show receipts read
 * it from different places — the act's copy is already uploaded and streams from an authenticated
 * endpoint, the estimate import's is still a file the master just picked and is uploaded only after
 * the lines are committed — and that is the ONLY difference between them.
 */
export type ReceiptPhotoSource =
  | { kind: 'stored'; fileUrl: string }
  | { kind: 'file'; file: File };

/** One effect for both sources, so a caller never has to know which branch it is on. */
function useReceiptPhotoUrl(source: ReceiptPhotoSource): { url: string | null; failed: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const stored = source.kind === 'stored' ? source.fileUrl : null;
  const file = source.kind === 'file' ? source.file : null;

  useEffect(() => {
    let dead = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    if (file) {
      objectUrl = URL.createObjectURL(file);
      setUrl(objectUrl);
    } else if (stored) {
      // Receipt photos stream from an authenticated endpoint, so <img src> cannot carry the token.
      photosApi
        .fetchBlobUrl(stored)
        .then((u) => {
          if (dead) {
            URL.revokeObjectURL(u);
            return;
          }
          objectUrl = u;
          setUrl(u);
        })
        .catch(() => setFailed(true));
    }
    return () => {
      dead = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [stored, file]);

  return { url, failed };
}

/**
 * A receipt's photo wherever a receipt is shown: a thumbnail beside the row, or a preview above the
 * fields that ask the master to confirm what a reader guessed off it. A tap always opens the same
 * full-size view over whatever is on screen, so the values behind it survive.
 *
 * <p>It owns its own zoom dialog on purpose. Both receipt screens had grown their own copy of this
 * — «немає можливості переглядати чек для звірки вірності даних» was reported on one of them and
 * was equally true on the other — and two copies is exactly how they drift apart again.</p>
 */
export function ReceiptPhoto({
  source,
  title,
  variant,
}: {
  source: ReceiptPhotoSource;
  /** The receipt's own name — the zoom dialog's heading. */
  title: string;
  /** `thumb` beside a row, `preview` above a form. */
  variant: 'thumb' | 'preview';
}) {
  const { t } = useTranslation();
  const [zoomed, setZoomed] = useState(false);
  const { url, failed } = useReceiptPhotoUrl(source);
  const thumb = variant === 'thumb';

  return (
    <>
      <button
        type="button"
        disabled={!url}
        onClick={() => setZoomed(true)}
        aria-label={t('receipt.photo')}
        className={
          thumb
            ? 'h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-surface-sunken'
            : 'block w-full overflow-hidden rounded-lg bg-surface-sunken'
        }
      >
        {failed ? (
          <div className={cellClass(thumb)}>⚠️</div>
        ) : !url ? (
          <div className={cellClass(thumb)}>
            <Spinner size="sm" />
          </div>
        ) : (
          <img
            src={url}
            alt=""
            className={thumb ? 'h-full w-full object-cover' : 'max-h-48 w-full object-contain'}
          />
        )}
      </button>

      <Modal open={zoomed} onClose={() => setZoomed(false)} title={title}>
        {url && <img src={url} alt={title} className="max-h-[70vh] w-full object-contain" />}
      </Modal>
    </>
  );
}

function cellClass(thumb: boolean): string {
  return thumb
    ? 'flex h-full w-full items-center justify-center text-faint'
    : 'flex h-24 w-full items-center justify-center text-faint';
}

/**
 * The ordinal in front of a receipt row. It numbers the receipt, not what the receipt is called —
 * which is why it leads the row instead of sitting inside the title (master feedback).
 */
export function ReceiptOrdinal({ n, className = '' }: { n: number; className?: string }) {
  return (
    <span className={`w-5 shrink-0 text-sm font-semibold tabular-nums text-muted ${className}`}>
      {n}.
    </span>
  );
}
