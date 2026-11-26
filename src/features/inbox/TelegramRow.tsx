import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { usePhoneFromTelegram } from '@/features/profile/useProfile.ts';
import { useTelegram, useTelegramActions } from './useInbox.ts';
import { useConnectTelegram } from './useConnectTelegram.ts';

/**
 * Profile → «Telegram-бот» (majster-bot, iteration-master-contact). Not linked: one tap opens Telegram on a
 * one-time link that binds that chat. Linked: which account, «Сповіщення в Telegram» on/off, unlink — and,
 * when the bot has his number but the profile has none, an offer to put it on his documents (his tap only).
 * Hidden when this server has no bot.
 */
export function TelegramRow() {
  const { t } = useTranslation();
  const status = useTelegram();
  const actions = useTelegramActions();
  const { connect, pending } = useConnectTelegram();
  const { data: me } = useMe();
  const phoneFromTg = usePhoneFromTelegram();
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  if (!status.data?.available) return null;
  const linked = status.data.linked;
  const notificationsOn = status.data.notifications !== false;
  const offerPhone = Boolean(me?.contactPhone) && !me?.phone?.trim();

  const toggleNotifications = () => {
    actions.notifications.mutate(!notificationsOn, {
      onError: (err) => toast.error(toAppError(err).message),
    });
  };

  const addPhone = () => {
    phoneFromTg.mutate(undefined, {
      onSuccess: () => toast.success(t('telegram.phoneAdded')),
      onError: (err) => toast.error(toAppError(err).message),
    });
  };

  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex w-full items-center gap-3 p-3.5">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-surface-sunken text-base text-secondary">
          ✈️
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-primary">{t('telegram.title')}</span>
          <span className="block text-xs text-muted">
            {linked
              ? t('telegram.linked', { username: status.data.username ? `@${status.data.username}` : '' })
              : t('telegram.sub')}
          </span>
        </span>
        {linked ? (
          <button type="button" onClick={() => setConfirmUnlink(true)}
            className="min-h-11 flex-shrink-0 px-2 text-sm font-semibold text-muted">
            {t('telegram.unlink')}
          </button>
        ) : (
          <button type="button" onClick={connect} disabled={pending}
            className="min-h-11 flex-shrink-0 rounded-full bg-brand-soft px-3.5 text-sm font-semibold text-brand">
            {t('telegram.connect')}
          </button>
        )}
      </div>

      {linked && (
        // The whole line is the switch: a 24 px track alone is too small a target for a thumb.
        <button
          type="button"
          role="switch"
          aria-checked={notificationsOn}
          disabled={actions.notifications.isPending}
          onClick={toggleNotifications}
          className="flex min-h-11 w-full items-center gap-3 px-3.5 pb-3 text-left disabled:opacity-60"
        >
          <span className="min-w-0 flex-1 pl-11">
            <span className="block text-sm text-primary">{t('telegram.notifications')}</span>
            <span className="block text-xs text-muted">{t('telegram.notificationsSub')}</span>
          </span>
          <span className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
            notificationsOn ? 'bg-brand' : 'bg-border'}`}>
            <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              notificationsOn ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
          </span>
        </button>
      )}

      {offerPhone && (
        <div className="flex items-center gap-3 px-3.5 pb-3" data-testid="telegram-phone-offer">
          <span className="min-w-0 flex-1 pl-11 text-xs text-secondary">
            {t('telegram.phoneOffer', { phone: me?.contactPhone })}
          </span>
          <button type="button" onClick={addPhone} disabled={phoneFromTg.isPending}
            className="min-h-11 flex-shrink-0 rounded-full bg-brand-soft px-3.5 text-sm font-semibold text-brand">
            {t('telegram.phoneAdd')}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmUnlink}
        title={t('telegram.unlinkTitle')}
        message={t('telegram.unlinkConfirm')}
        confirmLabel={t('telegram.unlink')}
        loading={actions.unlink.isPending}
        onConfirm={() => actions.unlink.mutate(undefined, {
          onSuccess: () => setConfirmUnlink(false),
          onError: (err) => toast.error(toAppError(err).message),
        })}
        onClose={() => setConfirmUnlink(false)}
      />
    </div>
  );
}
