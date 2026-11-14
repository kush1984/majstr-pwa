import { useTranslation } from 'react-i18next';
import { InfoPopover } from '@/components/InfoPopover.tsx';

/**
 * A line's or a catalog position's comment: the master's own (V206/V207), else the library's hint it came
 * with. One thing to him — he edits or clears either in the same «Коментар» field.
 */
export function commentOf(item: { note?: string | null; description?: string | null }): string {
  return item.note?.trim() || item.description?.trim() || '';
}

/**
 * The comment behind an (i) beside the row, as the hints always were — never a line under the name, so a
 * row stays one row. A note the client does not see says so inside, with a lock.
 */
export function LineNote({ item, label }: {
  item: { name: string; note?: string | null; description?: string | null; noteVisible?: boolean };
  label?: string;
}) {
  const { t } = useTranslation();
  const comment = commentOf(item);
  if (comment === '') return null;
  const hidden = item.note?.trim() && item.noteVisible === false;
  return (
    <span className="flex flex-shrink-0 items-center pl-0.5">
      <InfoPopover label={label ?? item.name}>
        <span className="whitespace-pre-line">{comment}</span>
        {hidden && <span className="mt-1.5 block text-xs text-muted">🔒 {t('estimate.noteHidden')}</span>}
      </InfoPopover>
    </span>
  );
}
