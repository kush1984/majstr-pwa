import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { toast, useToast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { usePlanLimits } from '@/features/plan/usePlanLimits.ts';
import { useResendVerification } from './useEmailVerification.ts';
import { markTrialOfferSeen, noteVerificationState, trialOfferStore, wantsTrialOffer } from './trialOffer.ts';

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

const isVisible = () => document.visibilityState === 'visible';

/**
 * The card after the first send (see `trialOffer.ts`): a bottom sheet on a phone, one instance for
 * the whole app. N is the server's configured trial length (`/api/plan/limits` → `trialDays`), never
 * a number typed here — without it the card waits for the next send rather than guess.
 *
 * <p>It opens only when the page is VISIBLE and NO toast is on screen: «Поділитися» to Viber leaves
 * the app, so the card waits for his return; «Копіювати» shows «Скопійовано», so it waits for that to
 * fade. No fixed delay, and the toasts themselves are untouched.</p>
 */
export function TrialOfferHost() {
  const { t } = useTranslation();
  const pending = useSyncExternalStore(trialOfferStore.subscribe, trialOfferStore.pending);
  const { data: me } = useMe();
  const { data: limits } = usePlanLimits();
  const resend = useResendVerification();
  const { toasts } = useToast();
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, () => true);
  const [armed, setArmed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => { noteVerificationState(me); }, [me]);

  useEffect(() => {
    if (!pending) return;
    trialOfferStore.clear();
    if (wantsTrialOffer(me) && limits?.trialDays) setArmed(true);
  }, [pending, me, limits]);

  useEffect(() => {
    if (!armed || !visible || toasts.length > 0) return;
    setArmed(false);
    setOpen(true);
  }, [armed, visible, toasts.length]);

  if (!me || !limits?.trialDays) return null;

  const close = () => {
    markTrialOfferSeen(me.id);
    setOpen(false);
  };

  const onResend = async () => {
    try {
      await resend.mutateAsync();
      toast.success(t('email.sentCheckInbox'));
      close();
    } catch (err) {
      const e = toAppError(err);
      toast.error(e.status === 429 ? t('email.waitBeforeResendShort') : e.message);
    }
  };

  return (
    <Modal open={open} onClose={close} title={t('trialOffer.title', { count: limits.trialDays })}>
      <div className="mb-5 flex gap-3">
        <span className="text-2xl leading-none" aria-hidden="true">🎁</span>
        <p className="text-sm text-muted">{t('trialOffer.body', { email: me.email })}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Button fullWidth loading={resend.isPending} onClick={() => void onResend()}>
          {t('email.resend')}
        </Button>
        <Button variant="secondary" fullWidth onClick={close}>
          {t('common.later')}
        </Button>
      </div>
    </Modal>
  );
}
