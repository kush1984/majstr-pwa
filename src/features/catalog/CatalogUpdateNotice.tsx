import { useState } from 'react';
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
 * notice gets a real choice: accept (the master's own catalog item takes the new price — always,
 * since V178: an explicit tap is an explicit intent) or decline (dismiss, no price change). A
 * master who re-prices the position himself closes its notice as resolved on the server, and the
 * catalog invalidation (`['catalog']` is this key's prefix) takes it off the screen.
 *
 * ✕ / backdrop / system «Назад» on a price-drift notice is NOT «Лишити як є»: that declined ONE
 * offer and the next one popped straight up, so the dialog could not be closed. It asks once and
 * then declines EVERY queued price offer. The question is its own Modal swapped in for the notice,
 * never stacked on it — each keeps its own history entry, so «Назад» walks them correctly.
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

  const [confirmClose, setConfirmClose] = useState(false);

  const current = data?.[0];
  if (!current) return null;

  const busy = dismiss.isPending || accept.isPending;

  if (current.kind === 'PRICE_DRIFT') {
    const offers = (data ?? []).filter((n) => n.kind === 'PRICE_DRIFT');
    if (confirmClose) {
      const closeAll = () => {
        setConfirmClose(false);
        offers.forEach((n) => dismiss.mutate(n.id));
      };
      return (
        <Modal key="close-offers" open onClose={() => setConfirmClose(false)} title={t('catalog.updateNoticeCloseTitle')}>
          <p className="mb-5 text-sm text-muted">
            {t('catalog.updateNoticeCloseBody', { count: offers.length })}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setConfirmClose(false)}>
              {t('catalog.updateNoticeCloseBack')}
            </Button>
            <Button fullWidth onClick={closeAll}>
              {t('catalog.updateNoticeCloseConfirm')}
            </Button>
          </div>
        </Modal>
      );
    }
    return (
      <Modal key="offer" open onClose={() => setConfirmClose(true)} title={t('catalog.updateNoticePriceDriftTitle')}>
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
