import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { upgradeApi } from '@/api/upgrade.ts';

/**
 * Painted-door PRO modal. HONEST — no fake checkout: PRO isn't buyable yet, so we
 * say so and capture interest ("we'll write when it's ready, built to your need").
 * The optional reason is the most valuable signal. The CLICK is recorded by the
 * caller (the CTA); this modal records INTEREST on "Так, цікавить".
 */
export function UpgradeIntentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const close = () => {
    setReason('');
    setSent(false);
    onClose();
  };

  const submit = async () => {
    setBusy(true);
    try {
      await upgradeApi.interest(reason.trim() || undefined);
      setSent(true);
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title={t('upgrade.title')}>
      {sent ? (
        <div className="space-y-3">
          <p className="text-2xl">🙌</p>
          <p className="text-sm font-semibold text-primary">{t('upgrade.thanksTitle')}</p>
          <p className="text-sm text-secondary">{t('upgrade.thanksBody')}</p>
          <Button fullWidth onClick={close}>
            {t('common.close')}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-secondary">{t('upgrade.body')}</p>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted" htmlFor="upgrade-reason">
              {t('upgrade.reasonLabel')}
            </label>
            <textarea
              id="upgrade-reason"
              rows={3}
              maxLength={2000}
              placeholder={t('upgrade.reasonPlaceholder')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-primary focus:border-brand focus:outline-none"
            />
          </div>
          {me?.email && (
            <p className="text-xs text-muted">{t('upgrade.notifyAt', { email: me.email })}</p>
          )}
          <Button fullWidth loading={busy} onClick={submit}>
            {t('upgrade.yes')}
          </Button>
        </div>
      )}
    </Modal>
  );
}
