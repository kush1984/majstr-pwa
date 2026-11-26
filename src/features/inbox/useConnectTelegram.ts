import { useTranslation } from 'react-i18next';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { useTelegramActions } from './useInbox.ts';

/**
 * «Підключити» Telegram — the one flow, for the profile row and the offer after a first send
 * (iteration-master-contact). The tab is opened SYNCHRONOUSLY in the tap and pointed at the link once it
 * arrives: Safari blocks a window opened after an await, and the link needs a round trip.
 */
export function useConnectTelegram(onOpened?: () => void) {
  const { t } = useTranslation();
  const actions = useTelegramActions();

  const connect = () => {
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
        onOpened?.();
      },
      onError: (err) => {
        tab?.close();
        toast.error(toAppError(err).message);
      },
    });
  };

  return { connect, pending: actions.link.isPending };
}
