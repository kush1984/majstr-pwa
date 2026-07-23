import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { UpgradeBanner } from '@/components/UpgradeBanner.tsx';
import { useBlockedOps } from '@/lib/useOnline.ts';
import { dropBlockedOps, retryBlockedOps } from '@/lib/outbox/outbox.ts';
import type { OutboxOp } from '@/lib/outbox/types.ts';

/** A friendly name for a blocked op, dug out of its payload (shape differs per entity). */
function opName(op: OutboxOp): string {
  const p = op.payload as { name?: string; fullName?: string; req?: { name?: string } } | undefined;
  return p?.name ?? p?.fullName ?? p?.req?.name ?? '';
}

/**
 * The "PRO or delete" decision screen (Slice 3b). When the server permanently rejects queued
 * offline writes — almost always because they'd exceed the FREE plan (e.g. a trial lapsed while the
 * master was offline) — those changes are HELD, not dropped, and surfaced here. The master decides:
 * upgrade to PRO and keep them (then retry), or delete them. Nothing is discarded silently.
 */
export function SyncReviewSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const blocked = useBlockedOps();
  const overLimit = blocked.some((o) => o.blockReason === 'limit');
  const [busy, setBusy] = useState(false);

  // Once everything is resolved (retry succeeded, or all deleted), close.
  useEffect(() => {
    if (open && blocked.length === 0) onClose();
  }, [open, blocked.length, onClose]);

  const retry = async () => {
    setBusy(true);
    await retryBlockedOps();
    setBusy(false);
  };

  const dropAll = async () => {
    setBusy(true);
    await dropBlockedOps();
    // Refetch drops the never-synced optimistic entities from the cache (the server never got them).
    await qc.invalidateQueries();
    setBusy(false);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={t('sync.reviewTitle')}>
      <div className="space-y-3">
        <p className="text-sm text-secondary">
          {overLimit ? t('sync.reviewLimitBody', { n: blocked.length }) : t('sync.reviewBody', { n: blocked.length })}
        </p>

        <ul className="space-y-1.5">
          {blocked.map((op) => (
            <li key={op.seq} className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-sm">
              <span className="text-muted">{t(`sync.entity.${op.entity}`)}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-primary">{opName(op)}</span>
            </li>
          ))}
        </ul>

        {overLimit && <UpgradeBanner text={t('sync.upgradeHint')} trigger="OFFLINE_LIMIT" />}

        <div className="space-y-2 border-t border-border pt-3">
          <Button fullWidth loading={busy} onClick={() => void retry()}>{t('sync.retry')}</Button>
          <Button fullWidth variant="secondary" loading={busy} onClick={() => void dropAll()}>
            {t('sync.dropAll')}
          </Button>
          <button type="button" onClick={onClose} className="w-full py-2 text-center text-sm text-muted">
            {t('sync.later')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
