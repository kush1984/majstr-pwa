import { useTranslation } from 'react-i18next';
import { EmptyState } from './EmptyState.tsx';

/**
 * Offline, and this screen's data never reached the device.
 *
 * A third state that the app used to collapse into the other two, and lie in both directions:
 *  - as an ERROR ("Сервіс тимчасово недоступний, спробуйте за хвилину") it blames the server for
 *    the master's basement and offers a retry that cannot succeed;
 *  - as EMPTY ("Немає клієнтів", "Нічого не знайдено") it denies data the master really has.
 *
 * So say the true thing instead, and say what to do about it — the one thing neither of those
 * screens could. There is deliberately no retry button: a refetch without a connection is futile,
 * and React Query refetches on reconnect on its own.
 *
 * `what` names the data ("Каталог", "Шаблони") so the sentence is concrete; `compact` is the inline
 * variant for a slot inside a sheet or a section, where a full-height empty state does not fit.
 *
 * Do NOT use this where offline will not actually work afterwards — photos, for one: their list is
 * cacheable but the image blobs are not, so promising "далі працюватиме офлайн" there would be the
 * same kind of lie in a friendlier voice.
 */
export function OfflineNotCached({ what, compact }: { what?: string; compact?: boolean }) {
  const { t } = useTranslation();
  const title = what ? t('offline.notCachedNamed', { what }) : t('offline.notCachedTitle');

  if (compact) {
    return (
      <p className="rounded-xl border border-dashed border-border px-3 py-3 text-center text-xs leading-relaxed text-muted">
        📡 {title} {t('offline.notCachedHow')}
      </p>
    );
  }

  return (
    <EmptyState
      icon="📡"
      title={title}
      text={`${t('offline.notCachedHow')} ${t('offline.notCachedPrefetch')}`}
    />
  );
}
