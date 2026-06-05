import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { useResendVerification } from './useEmailVerification.ts';

/**
 * Shown when a share action returns 403 EMAIL_NOT_VERIFIED — a friendly
 * explanation with a resend button, instead of a bare error toast.
 */
export function EmailVerifyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const resend = useResendVerification();

  const onResend = async () => {
    try {
      await resend.mutateAsync();
      toast.success(t('email.sentCheckInbox'));
      onClose();
    } catch (err) {
      const e = toAppError(err);
      toast.error(e.status === 429 ? t('email.waitBeforeResendShort') : e.message);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('email.modalTitle')}>
      <div className="mb-5 flex gap-3">
        <span className="text-2xl leading-none">✉️</span>
        <p className="text-sm text-muted">
          {t('email.modalText')}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" fullWidth onClick={onClose}>
          {t('common.later')}
        </Button>
        <Button fullWidth loading={resend.isPending} onClick={onResend}>
          {t('email.sendLetter')}
        </Button>
      </div>
    </Modal>
  );
}
