import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { messageLinkApi } from '@/api/messageLink.ts';
import { toAppError } from '@/api/errors.ts';
import { toast } from '@/hooks/useToast.ts';
import { useOnline } from '@/lib/useOnline.ts';

/**
 * "Copy the message link" — the whole flow in one place, because it is offered from two: the object's
 * own screen and every row of the object list.
 *
 * <p>Minting needs the server, so this is online-only. That is not a limitation to work around: there
 * is no link to copy until the server has one, and queueing it offline would put a URL in the
 * clipboard that nobody can open.</p>
 */
export function useMessageLink(projectId: string) {
  const { t } = useTranslation();
  const online = useOnline();
  const [busy, setBusy] = useState(false);

  const copy = async () => {
    if (!online) {
      toast.error(t('messageLink.needConnection'));
      return;
    }
    setBusy(true);
    try {
      const { url } = await messageLinkApi.state(projectId);
      // The clipboard can legitimately refuse (no permission, insecure context, Safari's focus rules)
      // while the link itself was minted fine — so never claim "скопійовано" unless it landed. Same
      // reasoning as the portal sheet.
      const copied = navigator.clipboard
        ? await navigator.clipboard.writeText(url).then(() => true, () => false)
        : false;
      if (copied) toast.success(t('messageLink.copied'));
      else toast.error(t('messageLink.copyFailed', { url }));
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return { copy, busy };
}
