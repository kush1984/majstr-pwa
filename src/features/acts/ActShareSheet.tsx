import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { InfoPopover } from '@/components/InfoPopover.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { copyWhenReady } from '@/lib/asyncClipboard.ts';
import { actPortalApi } from '@/api/portal.ts';

/**
 * Share ONE act with the client (acts iteration, prompt 5). Publishing flips the act DRAFT→SENT and
 * mints its own link — a single document the client reviews and personally signs (NOT the read-only
 * economy portal). Publishes once on open, then offers copy / email / open. Honest wording: the
 * client confirms acceptance, not «юридично рівнозначно власноручному підпису».
 */
export function ActShareSheet({ actId, open, onClose }: { actId: string; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [busy, setBusy] = useState<'copy' | 'email' | null>(null);

  useEffect(() => {
    if (!open) { setUrl(null); return; }
    let alive = true;
    setPublishing(true);
    actPortalApi.publish(actId)
      .then((s) => { if (alive) setUrl(s.url); })
      .catch((err) => { if (alive) { toast.error(toAppError(err).message); onClose(); } })
      .finally(() => { if (alive) setPublishing(false); });
    return () => { alive = false; };
  }, [open, actId, onClose]);

  const onCopy = async () => {
    setBusy('copy');
    try {
      const { copied } = await copyWhenReady(() => Promise.resolve(url ?? ''));
      if (copied && url) { toast.success(t('estimate.linkCopied')); onClose(); }
      else toast.error(t('estimate.linkCopyFailed'));
    } finally { setBusy(null); }
  };

  const onEmail = async () => {
    setBusy('email');
    try {
      await actPortalApi.sendEmail(actId);
      toast.success(t('estimate.emailSent'));
      onClose();
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally { setBusy(null); }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('acts.shareTitle')}>
      <div className="space-y-3">
        <p className="flex items-center gap-1 text-sm text-muted">
          {t('acts.shareHint')}
          <InfoPopover text={t('acts.shareLegalInfo')} />
        </p>
        {publishing || !url ? (
          <div className="py-6 text-center text-brand"><Spinner /></div>
        ) : (
          <>
            <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
            <Button fullWidth loading={busy === 'copy'} onClick={() => void onCopy()}>{t('estimate.copyLink')}</Button>
            <div className="flex gap-2">
              <Button variant="secondary" fullWidth loading={busy === 'email'} onClick={() => void onEmail()}>
                {t('acts.shareEmail')}
              </Button>
              <Button variant="secondary" fullWidth onClick={() => window.open(url, '_blank')}>
                {t('common.open')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
