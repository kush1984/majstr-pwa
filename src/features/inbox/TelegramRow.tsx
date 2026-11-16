import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { useTelegram, useTelegramActions } from './useInbox.ts';

/**
 * Profile → «Telegram-бот» (majster-bot). Not linked: one tap opens Telegram on a one-time link
 * that binds that chat. Linked: says which account, and unlinks. Hidden when this server has no bot.
 */
export function TelegramRow() {
  const { t } = useTranslation();
  const status = useTelegram();
  const actions = useTelegramActions();
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  if (!status.data?.available) return null;
  const linked = status.data.linked;

  const connect = () => {
    // Opened synchronously in the tap, then pointed at the link: Safari blocks a window opened
    // after an await, and the link needs a round trip.
    const tab = window.open('', '_blank');
    actions.link.mutate(undefined, {
      onSuccess: (url) => {
        if (!url) {
          tab?.close();
          toast.error(t('telegram.unavailable'));
          return;
        }
        if (tab) tab.location.href = url;
        else window.location.href = url;
      },
      onError: (err) => {
        tab?.close();
        toast.error(toAppError(err).message);
      },
    });
  };

  return (
    <div className="flex w-full items-center gap-3 border-b border-border p-3.5 last:border-b-0">
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
        <button type="button" onClick={connect} disabled={actions.link.isPending}
          className="min-h-11 flex-shrink-0 rounded-full bg-brand-soft px-3.5 text-sm font-semibold text-brand">
          {t('telegram.connect')}
        </button>
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
