import { useTranslation } from 'react-i18next';
import { EmptyState } from './EmptyState.tsx';
import { OfflineNotCached } from './OfflineNotCached.tsx';
import { Button } from './Button.tsx';
import { useOnline } from '@/lib/useOnline.ts';
import { toAppError } from '@/api/errors.ts';

/**
 * Friendly inline error for a failed data fetch — "Сервіс тимчасово
 * недоступний, спробуйте за хвилину" with a "Спробувати ще раз" button, instead
 * of a blank screen or a raw error. Pass the React Query `error` so we can show
 * a tailored message (network vs. server) and the `onRetry` (usually
 * `refetch`). Drop-in for the `isError` branch of any page.
 *
 * Every call site renders this only when there is NO cached data (`isError && !data`), so offline it
 * means one specific thing — this screen never made it onto the device — and gets its own copy from
 * {@link OfflineNotCached}. `what` names the data for that sentence; the server-is-down copy below
 * still covers the online case, where a retry is worth offering.
 */
export function ErrorState({
  error,
  onRetry,
  title,
  what,
}: {
  error?: unknown;
  onRetry?: () => void;
  title?: string;
  what?: string;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const app = error !== undefined ? toAppError(error) : undefined;
  // A missing HTTP status means the request never reached the server (offline /
  // backend down) — show the "temporarily unavailable, try in a minute" copy.
  const isNetwork = app !== undefined && app.status === undefined;

  // Offline is not an outage: the server is fine, the master just has no signal. A real server
  // error that did arrive before the signal dropped (it has a status) keeps its own message.
  if (!online && isNetwork) return <OfflineNotCached what={what} />;

  return (
    <EmptyState
      icon="⚠️"
      title={title ?? t('errors.unavailableTitle')}
      text={isNetwork ? t('errors.unavailableText') : app?.message ?? t('errors.unavailableText')}
      action={
        onRetry && (
          <Button onClick={onRetry}>{t('common.retry')}</Button>
        )
      }
    />
  );
}
