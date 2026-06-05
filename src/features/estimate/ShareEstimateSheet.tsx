import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { estimatesApi } from '@/api/estimates.ts';
import type { ProjectResponse } from '@/api/types.ts';
import { useClient, useUpdateClient } from '@/features/clients/useClients.ts';

/**
 * "Поділитися з клієнтом" sheet. Offers email + copy-link when the client has
 * an email, copy-only (plus an inline "add email") when they don't. Both
 * actions create/reuse the share link and flip the estimate DRAFT → SENT.
 *
 * Gate handling: an unverified contractor (403 EMAIL_NOT_VERIFIED) is bounced
 * to the parent's verify modal; a missing client email (400 CLIENT_EMAIL_MISSING)
 * reveals the inline add-email field.
 */
export function ShareEstimateSheet({
  open,
  onClose,
  estimateId,
  project,
  onNeedEmailVerify,
}: {
  open: boolean;
  onClose: () => void;
  estimateId: string;
  project: ProjectResponse;
  onNeedEmailVerify: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const client = useClient(project.clientId ?? '', open && Boolean(project.clientId));
  const updateClient = useUpdateClient();
  const [busy, setBusy] = useState<'copy' | 'email' | null>(null);
  const [showAddEmail, setShowAddEmail] = useState(false);
  const [emailInput, setEmailInput] = useState('');

  const email = client.data?.email ?? null;

  const invalidateAfterShare = () => {
    qc.invalidateQueries({ queryKey: ['projects'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['project-estimates'] });
    qc.invalidateQueries({ queryKey: ['estimate', estimateId] });
  };

  /** Translate a share error to UX; handles all the gates in one place. */
  const handleError = (err: unknown) => {
    const e = toAppError(err);
    if (e.code === 'EMAIL_NOT_VERIFIED') {
      onClose();
      onNeedEmailVerify();
    } else if (e.code === 'CLIENT_EMAIL_MISSING') {
      toast.error(t('estimate.clientEmailMissing'));
      setShowAddEmail(true);
    } else if (e.status === 429) {
      toast.error(t('estimate.tooManyEmails'));
    } else if (e.status === 403) {
      toast.error(t('estimate.portalProOnly'));
    } else {
      toast.error(e.message);
    }
  };

  const onCopy = async () => {
    setBusy('copy');
    try {
      const link = await estimatesApi.createShareLink(estimateId);
      await navigator.clipboard?.writeText(link.url).catch(() => undefined);
      invalidateAfterShare();
      toast.success(t('estimate.linkCopied'));
      onClose();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  };

  const onEmail = async () => {
    setBusy('email');
    try {
      await estimatesApi.sendShareEmail(estimateId);
      invalidateAfterShare();
      toast.success(t('estimate.emailSent'));
      onClose();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  };

  const onSaveEmail = async () => {
    const c = client.data;
    if (!c || !project.clientId) return;
    if (!emailInput.includes('@')) {
      toast.error(t('estimate.enterValidEmail'));
      return;
    }
    try {
      await updateClient.mutateAsync({
        id: project.clientId,
        req: {
          fullName: c.fullName,
          phone: c.phone,
          address: c.address ?? undefined,
          email: emailInput.trim(),
        },
      });
      toast.success(t('estimate.clientEmailSaved'));
      setShowAddEmail(false);
      setEmailInput('');
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('estimate.shareSheetTitle')}>
      <div className="space-y-3">
        {email && (
          <Button fullWidth loading={busy === 'email'} onClick={onEmail}>
            {t('estimate.sendToEmail', { email })}
          </Button>
        )}

        <Button
          variant={email ? 'secondary' : 'primary'}
          fullWidth
          loading={busy === 'copy'}
          onClick={onCopy}
        >
          {t('estimate.copyLink')}
        </Button>

        {!email && project.clientId && (
          <div className="rounded-xl bg-surface-sunken p-3">
            <p className="mb-2 text-xs text-muted">
              {t('estimate.addClientEmailHint')}
            </p>
            {showAddEmail ? (
              <div className="space-y-2">
                <Input
                  type="email"
                  inputMode="email"
                  placeholder="client@example.com"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button variant="secondary" fullWidth onClick={() => setShowAddEmail(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button fullWidth loading={updateClient.isPending} onClick={onSaveEmail}>
                    {t('common.save')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="secondary"
                fullWidth
                onClick={() => {
                  setEmailInput('');
                  setShowAddEmail(true);
                }}
              >
                {t('estimate.addClientEmail')}
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
