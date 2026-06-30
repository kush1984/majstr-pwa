import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { routes } from '@/lib/config.ts';
import { useRecordConsent, useAcknowledgeClientData } from './useConsent.ts';

/**
 * One-time privacy-policy consent for users who registered before the consent
 * checkbox existed (their `consentedToPrivacyAt` is null). Required — no dismiss;
 * the only resolution is "Погоджуюся", which stamps consent and closes it.
 */
export function PrivacyConsentModal() {
  const { t } = useTranslation();
  const record = useRecordConsent();

  const agree = async () => {
    try {
      await record.mutateAsync();
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  return (
    <Modal open dismissable={false} onClose={() => {}} title={t('consent.loginTitle')}>
      <div className="space-y-4">
        <p className="text-sm text-secondary">{t('consent.loginBody')}</p>
        <Link to={routes.privacy} target="_blank" className="block text-sm font-semibold text-brand underline">
          {t('consent.loginReadPolicy')}
        </Link>
        <Button fullWidth loading={record.isPending} onClick={agree}>
          {t('consent.loginAgree')}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * One-time acknowledgement that the master is responsible for the client data
 * they enter (controller/operator distinction). Shown when they first enter
 * client data and `acknowledgedClientDataAt` is null. `onResolved` fires after a
 * successful stamp; `onCancel` backs out (the caller reverts the client mode).
 */
export function ClientDataAckModal({
  onResolved,
  onCancel,
}: {
  onResolved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const ack = useAcknowledgeClientData();

  const confirm = async () => {
    try {
      await ack.mutateAsync();
      onResolved();
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  return (
    <Modal open onClose={onCancel} title={t('consent.clientDataTitle')}>
      <div className="space-y-4">
        <p className="text-sm text-secondary">{t('consent.clientDataBody')}</p>
        <Button fullWidth loading={ack.isPending} onClick={confirm}>
          {t('consent.clientDataConfirm')}
        </Button>
      </div>
    </Modal>
  );
}
