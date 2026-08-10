import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { catalogApi } from '@/api/catalog.ts';
import type { CatalogUpdateNoticeResponse } from '@/api/types.ts';

const KEY = ['catalog', 'update-notice'] as const;

/**
 * "Ваш каталог оновлено" / "Ринкова ціна змінилась" — shown once per pending notice, on app
 * entry. The backend returns a QUEUE, not a single slot (a master can have a migration's count
 * notice AND several community price-drift notices at once); this shows the OLDEST one at a
 * time, resolving it drops it from the cached list and reveals the next — one thing at a time,
 * never a stacked list of modals.
 *
 * A count notice ("N positions added/removed") only ever had one button — dismiss. A price-drift
 * notice gets a real choice: accept (updates the master's own catalog item to the new price, but
 * ONLY if it still carries the old price named — a price they edited themselves is never
 * touched) or decline (dismiss, no price change either way).
 *
 * Deliberately silent when there is nothing to say: no banner, no spinner, no layout shift on the
 * ~100% of app opens where the queue is empty.
 */
export function CatalogUpdateNotice() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: KEY,
    queryFn: () => catalogApi.updateNotices(),
    staleTime: 5 * 60_000,
    // Offline this simply does not render — a stale notice is not worth a queued request, and it
    // will be waiting the next time the master is online.
    retry: false,
  });

  const dropFromQueue = (id: string) =>
    qc.setQueryData<CatalogUpdateNoticeResponse[]>(KEY, (prev) => (prev ?? []).filter((n) => n.id !== id));

  const dismiss = useMutation({
    mutationFn: (id: string) => catalogApi.dismissUpdateNotice(id),
    // Close immediately: the master pressed the button, and a failed dismiss only means the
    // notice returns once more — far better than a modal that hangs on a bad connection.
    onMutate: (id) => dropFromQueue(id),
  });

  const accept = useMutation({
    mutationFn: (id: string) => catalogApi.acceptUpdateNotice(id),
    onMutate: (id) => dropFromQueue(id),
  });

  const current = data?.[0];
  if (!current) return null;

  const busy = dismiss.isPending || accept.isPending;

  if (current.kind === 'PRICE_DRIFT') {
    return (
      <Modal open onClose={() => dismiss.mutate(current.id)} title={t('catalog.updateNoticePriceDriftTitle')}>
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {t('catalog.updateNoticePriceDriftBody', {
              position: current.positionName,
              oldPrice: current.oldPrice,
              newPrice: current.newPrice,
            })}
          </p>
          <Button fullWidth loading={accept.isPending} disabled={busy} onClick={() => accept.mutate(current.id)}>
            {t('catalog.updateNoticeAccept')}
          </Button>
          <Button
            variant="secondary"
            fullWidth
            loading={dismiss.isPending}
            disabled={busy}
            onClick={() => dismiss.mutate(current.id)}
          >
            {t('catalog.updateNoticeDecline')}
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={() => dismiss.mutate(current.id)} title={t('catalog.updateNoticeTitle')}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {current.added > 0 && (
            <span className="rounded-lg bg-brand-soft px-2.5 py-1 text-sm font-semibold text-brand">
              {t('catalog.updateNoticeAdded', { count: current.added })}
            </span>
          )}
          {current.removed > 0 && (
            <span className="rounded-lg bg-surface-sunken px-2.5 py-1 text-sm font-semibold text-muted">
              {t('catalog.updateNoticeRemoved', { count: current.removed })}
            </span>
          )}
        </div>
        <p className="text-sm text-muted">{t('catalog.updateNoticeBody')}</p>
        <Button fullWidth loading={dismiss.isPending} onClick={() => dismiss.mutate(current.id)}>
          {t('catalog.updateNoticeOk')}
        </Button>
      </div>
    </Modal>
  );
}
