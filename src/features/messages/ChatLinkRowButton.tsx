import { useTranslation } from 'react-i18next';
import { ActionMenu, ActionMenuItem } from '@/components/ActionMenu.tsx';
import { useMessageLink } from './useMessageLink.ts';

/**
 * The ⋮ on a row of the object list: one tap to the object's chat link.
 *
 * <p>It used to open a centred dialog holding a single button, which made copying a link a
 * three-tap job — ⋯, read the dialog, press, and it dismisses. As a dropped menu the action IS the
 * menu line, so it is two.</p>
 *
 * <p>The privacy line comes with it rather than being dropped. It is the one thing about this link
 * a master needs to be sure of before sending it to a client, and it costs a row of muted text. The
 * revoke stays off here as before: from a list the master wants the link, and a destructive action
 * next to it is a mis-tap waiting to happen — the object's own screen has room for it.</p>
 */
export function ChatLinkRowButton({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const { t } = useTranslation();
  const { copy } = useMessageLink(projectId);

  return (
    <ActionMenu ariaLabel={t('messageLink.rowAria', { name: projectName })}>
      {(close) => (
        <>
          <ActionMenuItem
            icon="🔗"
            label={t('messageLink.copy')}
            onClick={() => { close(); void copy(); }}
          />
          <p className="border-t border-border px-4 py-2 text-[11px] leading-snug text-muted">
            {t('messageLink.hint')}
          </p>
        </>
      )}
    </ActionMenu>
  );
}
