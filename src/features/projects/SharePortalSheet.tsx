import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { copyWhenReady } from '@/lib/asyncClipboard.ts';
import { portalApi, economyPortalApi, estimateShareApi } from '@/api/portal.ts';
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
 * "Поділитися з клієнтом" — two entry points that mint two genuinely different links, which is why
 * the scope difference is not just a display filter:
 *
 * - **From the object** (root / Економіка) — the master ticks which estimates the client will see
 *   and they all publish onto the OBJECT's one portal link, as sections of one page. Copy/email
 *   always PUBLISH first (PUT the ticked set), so the URL matches what was just chosen.
 * - **From one estimate's editor** (`singleEstimateId`) — mints that ESTIMATE's own `?t=` link
 *   instead (`estimateShareApi`). One link, one document: no picker, and the object's portal is
 *   neither read nor touched, so sharing one estimate can never add to — or quietly drop things
 *   from — what an already-sent object link shows.
 *
 * Gate handling is shared: an unverified contractor (403 EMAIL_NOT_VERIFIED) bounces to the
 * parent's verify modal; a missing client email (400 CLIENT_EMAIL_MISSING) reveals the inline
 * add-email field.
 */
export function SharePortalSheet({
  open,
  onClose,
  project,
  singleEstimateId,
  onNeedEmailVerify,
  mode,
}: {
  open: boolean;
  onClose: () => void;
  project: ProjectResponse;
  onNeedEmailVerify: () => void;
} & (
  /** Sharing ONE estimate on its own `?t=` link — no picker, no set, the object's portal untouched. */
  | { singleEstimateId: string; mode?: never }
  /**
   * Sharing the OBJECT's portal link, in one of its two genuinely separate contexts (different
   * links/tokens on the server):
   * - 'portal' (SIGNATURE, Кошторис tab) — any non-SIGNED estimate, for the client to sign; never
   *   has a payments toggle. A SIGNED estimate lives only in Економіка (economy-rework iteration),
   *   so the picker excludes it here even though the server would technically accept it.
   * - 'economy' (ECONOMY, Економіка tab) — SIGNED acts only (the server rejects anything else),
   *   plus an opt-in payments-visibility toggle.
   *
   * Either way, when the filtered list is empty the sheet collapses to just the neutral "nothing
   * yet" message — no picker/payments/publish chrome left dangling over an empty list.
   */
  | { singleEstimateId?: never; mode: 'portal' | 'economy' }
)) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  // Object-level share only — a single-estimate share has no set to seed from, so it never asks.
  const portal = useQuery({
    queryKey: ['portal', project.id, mode],
    queryFn: () => (mode === 'economy' ? economyPortalApi.state(project.id) : portalApi.state(project.id)),
    enabled: open && !singleEstimateId,
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
      // First-ever publish (nothing already shown, no editor-context preselect): default to the
      // obvious choice rather than an empty picker — the one pickable estimate if there's only
      // one, otherwise the most recently created one (the rest stay optional, one tap away).
      if (initial.size === 0) {
        const pickable = mode === 'economy'
          ? portal.data.estimates.filter((e) => e.status === 'SIGNED')
          : portal.data.estimates.filter((e) => e.status !== 'SIGNED');
        const defaultPick = pickable.length === 1
          ? pickable[0]
          : pickable.reduce<typeof pickable[number] | null>(
              (latest, e) => (!latest || e.createdAt > latest.createdAt ? e : latest),
              null,
            );
        if (defaultPick) initial.add(defaultPick.id);
      }
      setSelected(initial);
      setPaymentsOn(portal.data.paymentsVisible);
    }
  }, [open, portal.data, selected, mode]);

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

  // `handleError` is declared further down (it needs the client-email state); a ref lets the mint
  // effect below use it without re-running whenever its identity changes.
  const handleErrorRef = useRef<(err: unknown) => void>(() => {});
  // The estimate's own link, minted on open. Kept out of react-query on purpose: this is a POST
  // that mints/reuses server state, not a cacheable read.
  const [singleUrl, setSingleUrl] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  useEffect(() => {
    if (!open || !singleEstimateId) { setSingleUrl(null); return; }
    let alive = true;
    setMinting(true);
    estimateShareApi.create(singleEstimateId)
      .then((link) => { if (alive) setSingleUrl(link.url); })
      // Minting is what trips the plan / verify gates, so a failure here must land in the same
      // place a failed publish does rather than leaving an empty sheet open.
      .catch((err) => { if (alive) handleErrorRef.current(err); })
      .finally(() => { if (alive) setMinting(false); });
    return () => { alive = false; };
  }, [open, singleEstimateId]);

  const email = client.data?.email ?? null;
  const allEstimates = portal.data?.estimates ?? [];
  // An estimate already published from the OTHER context stays published either way (still
  // counted in `ticked`/`serverVisibleCount` below, computed from the unfiltered list) — this
  // picker just doesn't render or touch it here, it doesn't unpublish it.
  const list = mode === 'economy'
    ? allEstimates.filter((e) => e.status === 'SIGNED')
    : allEstimates.filter((e) => e.status !== 'SIGNED');
  const ticked = selected ?? new Set<string>();
  const serverVisibleCount = allEstimates.filter((e) => e.visible).length;

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
    // Publishing (or minting an estimate link) flips a DRAFT to SENT — refresh everything that
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

  handleErrorRef.current = handleError;

  // What "there is something to share" means differs per scope: a ticked set for the object's
  // link, a successfully minted URL for the estimate's own one.
  const nothingToShare = singleEstimateId ? !singleUrl : ticked.size === 0;

  const paymentsTicked = paymentsOn ?? false;
  // Nothing to publish from this context's angle — just say so. Any pick/publish/payments chrome
  // below would dangle over an empty list. A single-estimate share always has its one document.
  const filteredEmpty = !singleEstimateId && !portal.isPending && !portal.isError && list.length === 0;

  /** Publishes the ticked set on the link that matches `mode` — the SIGNATURE endpoint has no
   *  payments concept at all, the ECONOMY one always carries the toggle's current value. */
  const publish = (ids: string[]) =>
    mode === 'economy'
      ? economyPortalApi.update(project.id, ids, paymentsTicked)
      : portalApi.update(project.id, ids);

  const onCopy = async () => {
    setBusy('copy');
    try {
      // Clipboard can legitimately fail (no permission, non-secure context,
      // Safari focus rules) while the portal itself published fine — never
      // show "скопійовано" unless it actually landed in the clipboard.
      const { copied, value } = await copyWhenReady(async () => {
        if (singleEstimateId) return singleUrl ?? '';
        const state = await publish([...ticked]);
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
      if (singleEstimateId) {
        // The estimate's link is already minted — nothing to publish, just mail it.
        await estimateShareApi.sendEmail(singleEstimateId);
      } else {
        await publish([...ticked]);
        await (mode === 'economy' ? economyPortalApi.sendEmail(project.id) : portalApi.sendEmail(project.id));
      }
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
      await publish([]);
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
        {filteredEmpty ? (
          // Nothing this context can publish — the plain fact, no picker/payments/publish chrome
          // dangling under it (there is nothing here for those to act on).
          <p className="py-4 text-center text-sm text-muted">
            {t(mode === 'economy' ? 'portal.noSignedEstimates' : 'portal.noUnsignedEstimates')}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">
              {t(singleEstimateId
                ? 'portal.singleHint'
                : mode === 'economy' ? 'portal.pickHintSigned' : 'portal.pickHint')}
            </p>

            {singleEstimateId ? (
              // One link, one estimate — no picker, because there is nothing to choose. The URL
              // itself is shown: on a phone the master usually pastes it into a messenger, and
              // seeing it is what makes "this opens only that кошторис" believable.
              minting || !singleUrl ? (
                <div className="py-6 text-center text-brand"><Spinner /></div>
              ) : (
                <Input readOnly value={singleUrl} onFocus={(e) => e.currentTarget.select()} />
              )
            ) : portal.isPending ? (
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
                  </label>
                ))}
              </div>
            )}

            {/* Payments visibility is a contract concern — only offered alongside signed acts
                (Економіка); the SIGNATURE picker (mode 'portal') has no payments card at all. */}
            {mode === 'economy' && !singleEstimateId && !portal.isPending && !portal.isError && (
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
              <Button fullWidth disabled={nothingToShare} loading={busy === 'email'} onClick={onEmail}>
                {t('estimate.sendToEmail', { email })}
              </Button>
            )}

            <Button
              variant={email ? 'secondary' : 'primary'}
              fullWidth
              disabled={nothingToShare}
              loading={busy === 'copy'}
              onClick={onCopy}
            >
              {t('estimate.copyLink')}
            </Button>

            {!singleEstimateId && ticked.size === 0 && serverVisibleCount > 0 && (
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
          </>
        )}
      </div>
    </Modal>
  );
}
