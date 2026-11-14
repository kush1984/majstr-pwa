import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn.ts';
import type { EstimateItemResponse } from '@/api/types.ts';

/**
 * The master's own comment under a line's name (V206). One that the client does not see says so with a
 * lock, so the master never wonders whether «собі: …» went out with the estimate.
 */
export function LineNote({ item, className }: { item: EstimateItemResponse; className?: string }) {
  const { t } = useTranslation();
  const note = item.note?.trim() ?? '';
  if (note === '') return null;
  const hidden = item.noteVisible === false;
  return (
    <span className={cn('block whitespace-pre-line break-words text-[12px] leading-snug text-muted', className)}>
      {hidden && (
        <span role="img" aria-label={t('estimate.noteHidden')} title={t('estimate.noteHidden')} className="mr-1">
          🔒
        </span>
      )}
      {note}
    </span>
  );
}
