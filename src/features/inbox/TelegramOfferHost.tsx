import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { useMe } from '@/features/auth/useMe.ts';
import { wantsTrialOffer } from '@/features/email/trialOffer.ts';
import { useTelegram } from './useInbox.ts';
import { useConnectTelegram } from './useConnectTelegram.ts';
import { markTelegramOfferSeen, telegramOfferSeen, telegramOfferStore } from './telegramOffer.ts';

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

const isVisible = () => document.visibilityState === 'visible';

/**
 * The bottom sheet after an estimate really left the app (see `telegramOffer.ts`), one instance for the app.
 * Only when this server has a bot and his chat is not linked yet. The trial offer goes first after the same
 * send — two sheets never stack; this one then waits for the next send. Like that offer, it opens only when
 * the page is visible again: «Поділитися» to Viber leaves the app.
 */
export function TelegramOfferHost() {
  const { t } = useTranslation();
  const pending = useSyncExternalStore(telegramOfferStore.subscribe, telegramOfferStore.pending);
  const { data: me } = useMe();
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, () => true);
  // The bot's status is asked only after a send that may lead to the sheet — not on every screen.
  const [asked, setAsked] = useState(false);
  const status = useTelegram(asked);
  const [armed, setArmed] = useState(false);
  const [open, setOpen] = useState(false);

  const close = () => {
    if (me) markTelegramOfferSeen(me.id);
    setOpen(false);
  };
  const { connect, pending: connecting } = useConnectTelegram(close);

  useEffect(() => {
    if (!pending) return;
    telegramOfferStore.clear();
    if (me && !telegramOfferSeen(me.id) && !wantsTrialOffer(me)) setAsked(true);
  }, [pending, me]);

  useEffect(() => {
    if (!asked || !status.data) return;
    setAsked(false);
    if (status.data.available && !status.data.linked) setArmed(true);
  }, [asked, status.data]);

  useEffect(() => {
    if (!armed || !visible) return;
    setArmed(false);
    setOpen(true);
  }, [armed, visible]);

  if (!me) return null;

  return (
    <Modal open={open} onClose={close} title={t('telegramOffer.title')}>
      <div className="mb-5 flex gap-3">
        <span className="text-2xl leading-none" aria-hidden="true">✈️</span>
        <p className="text-sm text-muted">{t('telegramOffer.body')}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Button fullWidth loading={connecting} onClick={connect}>{t('telegramOffer.connect')}</Button>
        <Button variant="secondary" fullWidth onClick={close}>{t('telegramOffer.later')}</Button>
      </div>
    </Modal>
  );
}
