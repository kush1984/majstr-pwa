import { useTranslation } from 'react-i18next';
import { EmptyState } from './EmptyState.tsx';
import { Button } from './Button.tsx';
import { toAppError } from '@/api/errors.ts';

/**
 * Friendly inline error for a failed data fetch — "Сервіс тимчасово
 * недоступний, спробуйте за хвилину" with a "Спробувати ще раз" button, instead
 * of a blank screen or a raw error. Pass the React Query `error` so we can show
 * a tailored message (network vs. server) and the `onRetry` (usually
 * `refetch`). Drop-in for the `isError` branch of any page.
 */
export function ErrorState({
  error,
  onRetry,
  title,
}: {
  error?: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const { t } = useTranslation();
  const app = error !== undefined ? toAppError(error) : undefined;
  // A missing HTTP status means the request never reached the server (offline /
  // backend down) — show the "temporarily unavailable, try in a minute" copy.
  const isNetwork = app !== undefined && app.status === undefined;

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
