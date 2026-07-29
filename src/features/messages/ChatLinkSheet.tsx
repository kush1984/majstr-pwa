import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { messageLinkApi } from '@/api/messageLink.ts';
import { useMessageLink } from './useMessageLink.ts';

/**
 * «Посилання на чат» — the object's message link.
 *
 * <p>Controlled, so the same sheet serves both places the link is offered: the FAB on the object
 * screen and the ⋯ on a row of the object list. Both mint and hand back the same URL — the token is
 * per object, created once and reused after, so a link already sent in a chat keeps working.</p>
 *
 * <p>`allowRevoke` is off on the list row on purpose: from a row the master wants the link and nothing
 * else, and a destructive action next to it is a mis-tap waiting to happen. The object's own screen has
 * the room for it.</p>
 */
export function ChatLinkSheet({
  open,
  onClose,
  projectId,
  allowRevoke = false,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  allowRevoke?: boolean;
}) {
  const { t } = useTranslation();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const { copy, busy } = useMessageLink(projectId);

  const onCopy = async () => {
    await copy();
    onClose();
  };

  const onRevoke = async () => {
    setRevoking(true);
    try {
      await messageLinkApi.revoke(projectId);
      toast.success(t('messageLink.revoked'));
      setConfirmRevoke(false);
      onClose();
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setRevoking(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title={t('messageLink.title')}>
        <div className="space-y-3">
          <p className="text-sm text-muted">{t('messageLink.hint')}</p>
          <Button fullWidth loading={busy} onClick={() => void onCopy()}>
            {t('messageLink.copy')}
          </Button>
          {allowRevoke && (
            <Button variant="secondary" fullWidth onClick={() => setConfirmRevoke(true)}>
              {t('messageLink.revoke')}
            </Button>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmRevoke}
        title={t('messageLink.revokeTitle')}
        message={t('messageLink.revokeMessage')}
        confirmLabel={t('messageLink.revoke')}
        loading={revoking}
        onConfirm={() => void onRevoke()}
        onClose={() => setConfirmRevoke(false)}
      />
    </>
  );
}
