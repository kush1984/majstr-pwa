import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { billingApi } from '@/api/billing.ts';

/**
 * PRO purchase modal. Shows what PRO gives + the monthly price, then "Оплатити"
 * starts a monobank checkout and redirects the browser to the hosted payment
 * page. (Replaced the V34 painted-door "чи цікавить" once real billing shipped;
 * the caller still records the analytics click by trigger before opening this.)
 */
export function UpgradeIntentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const pay = async () => {
    setBusy(true);
    try {
      const { pageUrl } = await billingApi.checkout();
      // Leaves the app for the monobank hosted page (or the dev return URL).
      window.location.href = pageUrl;
    } catch (err) {
      toast.error(toAppError(err).message);
      setBusy(false); // stay on the modal so the user can retry
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('billing.proTitle')}>
      <div className="space-y-4">
        <p className="text-sm text-secondary">{t('billing.proBody')}</p>
        <p className="text-2xl font-extrabold text-primary">{t('billing.price')}</p>
        <Button fullWidth loading={busy} onClick={pay}>
          {t('billing.pay')}
        </Button>
        <p className="text-center text-xs text-muted">{t('billing.securedBy')}</p>
      </div>
    </Modal>
  );
}
