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
import { useClient, useCreateClient, useUpdateClient } from '@/features/clients/useClients.ts';
import { useUpdateProject } from '@/features/projects/useProjects.ts';
import {
  ClientPicker,
  clientDraftError,
  resolveClientId,
  type ClientDraft,
} from '@/features/clients/ClientPicker.tsx';

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
  // A client just attached in this sheet (project prop is from the parent and
  // won't update until it refetches) — fold it in so email becomes available.
  const [attachedClientId, setAttachedClientId] = useState<string | null>(null);
  const clientId = project.clientId ?? attachedClientId;
  const client = useClient(clientId ?? '', open && Boolean(clientId));
  const updateClient = useUpdateClient();
  const createClient = useCreateClient();
  const updateProject = useUpdateProject();
  const [busy, setBusy] = useState<'copy' | 'email' | null>(null);
  const [showAddEmail, setShowAddEmail] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  // No-client prompt: reveal a picker to attach an existing/new client.
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [clientDraft, setClientDraft] = useState<ClientDraft>({
    mode: 'existing',
    selectedId: null,
    newClient: { fullName: '', phone: '', email: '' },
  });

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
      // Clipboard can legitimately fail (no permission, non-secure context,
      // Safari focus rules) while the share link itself was created fine —
      // never show "скопійовано" unless it actually landed in the clipboard.
      const copied = navigator.clipboard
        ? await navigator.clipboard.writeText(link.url).then(() => true, () => false)
        : false;
      invalidateAfterShare();
      if (copied) {
        toast.success(t('estimate.linkCopied'));
        onClose();
      } else {
        // Link exists but isn't in the buffer — tell the truth and keep the
        // sheet open so the user can try again.
        toast.error(t('estimate.linkCopyFailed'));
      }
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

  /** Attach an existing/new client to the object so the estimate can be sent. */
  const onAttachClient = async () => {
    const err = clientDraftError(clientDraft);
    if (err) {
      toast.error(t(err));
      return;
    }
    try {
      const newClientId = await resolveClientId(clientDraft, createClient);
      if (!newClientId) return;
      await updateProject.mutateAsync({
        id: project.id,
        req: {
          name: project.name,
          address: project.address,
          description: project.description ?? undefined,
          clientId: newClientId,
        },
      });
      setAttachedClientId(newClientId);
      setShowClientPicker(false);
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success(t('estimate.clientAttached'));
    } catch (err2) {
      toast.error(toAppError(err2).message);
    }
  };

  const onSaveEmail = async () => {
    const c = client.data;
    if (!c || !clientId) return;
    if (!emailInput.includes('@')) {
      toast.error(t('estimate.enterValidEmail'));
      return;
    }
    try {
      await updateClient.mutateAsync({
        id: clientId,
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

        {!clientId && (
          <div className="rounded-xl bg-surface-sunken p-3">
            <p className="mb-2 text-xs text-muted">{t('estimate.noClientShareHint')}</p>
            {showClientPicker ? (
              <div className="space-y-2">
                <ClientPicker value={clientDraft} onChange={setClientDraft} allowNone={false} />
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    fullWidth
                    onClick={() => setShowClientPicker(false)}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    fullWidth
                    loading={createClient.isPending || updateProject.isPending}
                    onClick={onAttachClient}
                  >
                    {t('estimate.addClientToShare')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="secondary" fullWidth onClick={() => setShowClientPicker(true)}>
                {t('estimate.addClientToShare')}
              </Button>
            )}
          </div>
        )}

        {!email && clientId && (
          <div className="rounded-xl bg-surface-sunken p-3">
            <p className="mb-2 text-xs text-muted">
              {t('estimate.addClientEmailHint')}
            </p>
            {showAddEmail ? (
              <div className="space-y-2">
                <Input
                  type="email"
                  inputMode="email"
                  placeholder={t('estimate.clientEmailPlaceholder')}
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
