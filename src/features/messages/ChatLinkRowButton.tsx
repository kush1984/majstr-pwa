import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatLinkSheet } from './ChatLinkSheet.tsx';

/**
 * The ⋯ on a row of the object list: one tap to the object's chat link.
 *
 * <p>Opens the sheet with nothing but «Скопіювати». From a list the master wants the link, and a row is
 * no place for a wall of explanation or a revoke button — that lives on the object's own screen.</p>
 */
export function ChatLinkRowButton({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('messageLink.rowAria', { name: projectName })}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-base text-muted active:bg-surface-sunken"
      >
        ⋯
      </button>
      <ChatLinkSheet open={open} onClose={() => setOpen(false)} projectId={projectId} />
    </>
  );
}
