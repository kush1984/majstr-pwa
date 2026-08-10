import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { copyWhenReady } from '@/lib/asyncClipboard.ts';
import { portalApi } from '@/api/portal.ts';
import type { ProjectResponse } from '@/api/types.ts';
import { estimateName } from '@/features/estimate/estimateName.ts';
import { useClient, useCreateClient, useUpdateClient } from '@/features/clients/useClients.ts';
import { useUpdateProject } from '@/features/projects/useProjects.ts';
import {
  ClientPicker,
  clientDraftError,
  resolveClientId,
  type ClientDraft,
} from '@/features/clients/ClientPicker.tsx';

/**
 * "Поділитися з клієнтом" — the object's portal. The master ticks which
 * estimates the client will see (one link shows them all as sections), then
 * copies the link or emails it. Copy/email always PUBLISH first (PUT the
 * ticked set), so the URL matches what was just chosen — nothing is shared
 * implicitly.
 *
 * Gate handling mirrors the old per-estimate sheet: an unverified contractor
 * (403 EMAIL_NOT_VERIFIED) bounces to the parent's verify modal; a missing
 * client email (400 CLIENT_EMAIL_MISSING) reveals the inline add-email field.
 */
export function SharePortalSheet({
  open,
  onClose,
  project,
  preselectEstimateId,
  onNeedEmailVerify,
}: {
  open: boolean;
  onClose: () => void;
  project: ProjectResponse;
  /** Ticked in addition to the already-visible set (the editor's own estimate). */
  preselectEstimateId?: string;
  onNeedEmailVerify: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const portal = useQuery({
    queryKey: ['portal', project.id],
    queryFn: () => portalApi.state(project.id),
    enabled: open,
  });

  // null = "not initialised yet" — seeded from the server state once loaded.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  // Off by default — the master opts in explicitly (mirrors the backend default).
  const [paymentsOn, setPaymentsOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!open) {
      setSelected(null);
      setPaymentsOn(null);
      return;
    }
    if (portal.data && selected === null) {
      const initial = new Set(portal.data.estimates.filter((e) => e.visible).map((e) => e.id));
      if (preselectEstimateId) initial.add(preselectEstimateId);
      setSelected(initial);
      setPaymentsOn(portal.data.paymentsVisible);
    }
  }, [open, portal.data, selected, preselectEstimateId]);

  // A client just attached in this sheet (project prop is from the parent and
  // won't update until it refetches) — fold it in so email becomes available.
  const [attachedClientId, setAttachedClientId] = useState<string | null>(null);
  const clientId = project.clientId ?? attachedClientId;
  const client = useClient(clientId ?? '', open && Boolean(clientId));
  const updateClient = useUpdateClient();
  const createClient = useCreateClient();
  const updateProject = useUpdateProject();
  const [busy, setBusy] = useState<'copy' | 'email' | 'hide' | null>(null);
  const [showAddEmail, setShowAddEmail] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [clientDraft, setClientDraft] = useState<ClientDraft>({
    mode: 'existing',
    selectedId: null,
    newClient: { fullName: '', phone: '', email: '' },
  });

  const email = client.data?.email ?? null;
  const list = portal.data?.estimates ?? [];
  const ticked = selected ?? new Set<string>();
  const serverVisibleCount = list.filter((e) => e.visible).length;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const invalidateAfterShare = () => {
    void qc.invalidateQueries({ queryKey: ['portal', project.id] });
    // Publishing flips newly-visible DRAFTs to SENT — refresh everything that
    // shows an estimate status.
    void qc.invalidateQueries({ queryKey: ['projects'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['project-estimates'] });
    void qc.invalidateQueries({ queryKey: ['estimate'] });
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

  const paymentsTicked = paymentsOn ?? false;

  const onCopy = async () => {
    setBusy('copy');
    try {
      // Clipboard can legitimately fail (no permission, non-secure context,
      // Safari focus rules) while the portal itself published fine — never
      // show "скопійовано" unless it actually landed in the clipboard.
      const { copied, value } = await copyWhenReady(async () => {
        const state = await portalApi.update(project.id, [...ticked], paymentsTicked);
        return state.url ?? '';
      });
      invalidateAfterShare();
      if (copied && value) {
        toast.success(t('estimate.linkCopied'));
        onClose();
      } else {
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
      await portalApi.update(project.id, [...ticked], paymentsTicked);
      await portalApi.sendEmail(project.id);
      invalidateAfterShare();
      toast.success(t('estimate.emailSent'));
      onClose();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  };

  /** Unpublish everything — the portal page then tells the client the master removed the estimates. */
  const onHideAll = async () => {
    setBusy('hide');
    try {
      await portalApi.update(project.id, [], false);
      invalidateAfterShare();
      toast.success(t('portal.hiddenAll'));
      onClose();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  };

  /** Attach an existing/new client to the object so the portal can be emailed. */
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
      void qc.invalidateQueries({ queryKey: ['projects'] });
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
    <Modal open={open} onClose={onClose} title={t('portal.sheetTitle')}>
      <div className="space-y-3">
        <p className="text-sm text-muted">{t('portal.pickHint')}</p>

        {portal.isPending ? (
          <div className="py-6 text-center"><Spinner /></div>
        ) : portal.isError ? (
          <p className="py-4 text-center text-sm text-muted">{t('portal.loadError')}</p>
        ) : (
          <div className="space-y-1.5">
            {list.map((e) => (
              <label key={e.id}
                className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2">
                <input
                  type="checkbox"
                  checked={ticked.has(e.id)}
                  onChange={() => toggle(e.id)}
                  className="h-5 w-5 rounded border-border text-brand focus:ring-brand-200"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-primary">
                  {estimateName(e.name, e.createdAt)}
                </span>
                {e.status === 'SIGNED' && (
                  <span className="whitespace-nowrap text-[11px] font-semibold text-success">
                    ✓ {t('status.estimate.SIGNED')}
                  </span>
                )}
              </label>
            ))}
          </div>
        )}

        {!portal.isPending && !portal.isError && (
          <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface px-3 py-2">
            <input
              type="checkbox"
              checked={paymentsTicked}
              onChange={() => setPaymentsOn((prev) => !(prev ?? false))}
              className="mt-0.5 h-5 w-5 rounded border-border text-brand focus:ring-brand-200"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-primary">{t('portal.showPayments')}</span>
              <span className="block text-xs text-muted">{t('portal.showPaymentsHint')}</span>
            </span>
          </label>
        )}

        {email && (
          <Button fullWidth disabled={ticked.size === 0} loading={busy === 'email'} onClick={onEmail}>
            {t('estimate.sendToEmail', { email })}
          </Button>
        )}

        <Button
          variant={email ? 'secondary' : 'primary'}
          fullWidth
          disabled={ticked.size === 0}
          loading={busy === 'copy'}
          onClick={onCopy}
        >
          {t('estimate.copyLink')}
        </Button>

        {ticked.size === 0 && serverVisibleCount > 0 && (
          <Button variant="secondary" fullWidth loading={busy === 'hide'} onClick={onHideAll}>
            {t('portal.hideAll')}
          </Button>
        )}

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
