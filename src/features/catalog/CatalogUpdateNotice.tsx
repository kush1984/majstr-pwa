import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { catalogApi } from '@/api/catalog.ts';

const KEY = ['catalog', 'update-notice'] as const;

/**
 * "Ваш каталог оновлено" — shown once, on app entry, when a catalog migration rewrote this
 * master's own catalog.
 *
 * The catalog is what a master quotes from. Changing it under them and saying nothing reads as
 * data loss, so the notice names both numbers — what arrived AND what we took away — and states
 * plainly that their own positions and their own prices were not touched, because that is the
 * first thing they will worry about.
 *
 * Deliberately silent when there is nothing to say: no banner, no spinner, no layout shift on the
 * ~100% of app opens where `pending` is false.
 */
export function CatalogUpdateNotice() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: KEY,
    queryFn: () => catalogApi.updateNotice(),
    staleTime: 5 * 60_000,
    // Offline this simply does not render — a stale notice is not worth a queued request, and it
    // will be waiting the next time the master is online.
    retry: false,
  });

  const dismiss = useMutation({
    mutationFn: () => catalogApi.dismissUpdateNotice(),
    // Close immediately: the master pressed the button, and a failed dismiss only means the
    // notice returns once more — far better than a modal that hangs on a bad connection.
    onMutate: () => qc.setQueryData(KEY, { pending: false, added: 0, removed: 0 }),
  });

  if (!data?.pending) return null;

  return (
    <Modal open onClose={() => dismiss.mutate()} title={t('catalog.updateNoticeTitle')}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {data.added > 0 && (
            <span className="rounded-lg bg-brand-soft px-2.5 py-1 text-sm font-semibold text-brand">
              {t('catalog.updateNoticeAdded', { count: data.added })}
            </span>
          )}
          {data.removed > 0 && (
            <span className="rounded-lg bg-surface-sunken px-2.5 py-1 text-sm font-semibold text-muted">
              {t('catalog.updateNoticeRemoved', { count: data.removed })}
            </span>
          )}
        </div>
        <p className="text-sm text-muted">{t('catalog.updateNoticeBody')}</p>
        <Button fullWidth onClick={() => dismiss.mutate()}>
          {t('catalog.updateNoticeOk')}
        </Button>
      </div>
    </Modal>
  );
}
