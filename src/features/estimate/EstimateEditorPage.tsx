import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/Badge.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Modal } from '@/components/Modal.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { ErrorState } from '@/components/ErrorState.tsx';
import { estimatesApi } from '@/api/estimates.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { formatMoney, formatNumber, initials } from '@/lib/format.ts';
import { parseDecimal } from '@/lib/decimal.ts';
import { cn } from '@/lib/cn.ts';
import { ESTIMATE_STATUS_VARIANT } from '@/lib/labels.ts';
import i18n from '@/lib/i18n.ts';
import { routes } from '@/lib/config.ts';
import type { EstimateItemResponse, EstimateResponse, ProjectResponse, Trade } from '@/api/types.ts';
import { TradeSelect } from './TradeSelect.tsx';
import { useProject } from '@/features/projects/useProjects.ts';
import { EmailVerifyModal } from '@/features/email/EmailVerifyModal.tsx';
import { ItemForm } from './ItemForm.tsx';
import { AddItemSheet } from './AddItemSheet.tsx';
import { SharePortalSheet } from '@/features/projects/SharePortalSheet.tsx';
import { ReceiptImportSheet } from './ReceiptImportSheet.tsx';
import { UpgradeIntentModal } from '@/features/upgrade/UpgradeIntentModal.tsx';
import { useMe } from '@/features/auth/useMe.ts';
import { useOnlineGuard } from '@/hooks/useOnlineGuard.ts';
import { useEmailGate } from '@/features/email/useEmailGate.ts';
import { upgradeApi } from '@/api/upgrade.ts';
import { estimateName } from './estimateName.ts';
import {
  useEstimate,
  useRemoveItem,
  useUpdateItem,
  useUpdateEstimate,
  useReopenEstimate,
  useDeleteEstimate,
} from './useEstimate.ts';
import { useSaveAsTemplate } from './useEstimateTemplates.ts';

function groupByCategory(items: EstimateItemResponse[]): [string, EstimateItemResponse[]][] {
  const noCategory = i18n.t('catalog.noCategory');
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  const groups = new Map<string, EstimateItemResponse[]>();
  for (const item of sorted) {
    const key = item.category?.trim() || noCategory;
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()];
}

export function EstimateEditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const estimate = useEstimate(id);
  const projectId = estimate.data?.projectId ?? '';
  const project = useProject(projectId);
  const updateItem = useUpdateItem(id);
  const removeItem = useRemoveItem(id);
  const updateEstimate = useUpdateEstimate(id);
  const reopenEstimate = useReopenEstimate(id);
  const deleteEstimate = useDeleteEstimate(id);

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<EstimateItemResponse | null>(null);
  const [deletingItem, setDeletingItem] = useState<EstimateItemResponse | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [emailGateOpen, setEmailGateOpen] = useState(false);
  const ensureEmailVerified = useEmailGate();
  const [fabOpen, setFabOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositValue, setDepositValue] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [reopenConfirmOpen, setReopenConfirmOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateTrade, setTemplateTrade] = useState<Trade | null>(null);
  const saveAsTemplate = useSaveAsTemplate(id);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const { data: me } = useMe();
  const isPro = (me?.plan ?? 'FREE') !== 'FREE';
  // Actions that genuinely need the server (PDF, sharing, LLM recognition) say so when offline.
  const { guard } = useOnlineGuard();

  if (estimate.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas text-brand">
        <Spinner size="lg" />
      </div>
    );
  }

  // Only DATA decides whether we can render. Offline the background refetch fails and leaves an
  // error ON the query while the cached estimate is still right there — branching on `isError`
  // first threw that data away, so the second visit to a screen with no signal showed
  // "не знайдено" instead of the estimate the master had just been reading.
  if (!estimate.data) {
    // Transient failure (offline / backend down / 5xx) is NOT "не знайдено" —
    // offer a retry instead of suggesting the estimate doesn't exist.
    const status = estimate.error ? toAppError(estimate.error).status : 404;
    if (estimate.isError && status !== 404 && status !== 403) {
      return (
        <div className="flex min-h-dvh items-center justify-center bg-canvas">
          <ErrorState
            error={estimate.error}
            what={t('offline.dataEstimate')}
            onRetry={() => void estimate.refetch()}
          />
        </div>
      );
    }
    return (
      <div className="min-h-dvh bg-canvas">
        <EmptyState
          icon="⚠️"
          title={t('estimate.notFoundTitle')}
          text={t('estimate.notFoundText')}
          action={<Button onClick={() => navigate(routes.projects)}>{t('estimate.toObjects')}</Button>}
        />
      </div>
    );
  }

  const est = estimate.data;
  const groups = groupByCategory(est.items);
  const nextSortOrder = est.items.length;
  // A signed estimate is read-only in the UI (the backend also enforces 409):
  // hide edit/delete, show a "view only" banner with a master-only reopen.
  const signed = est.status === 'SIGNED';

  const goBack = () => navigate(projectId ? routes.project(projectId) : routes.projects);

  const onPdf = async () => {
    // The PDF is a client-facing deliverable and now requires a verified email
    // (anti-abuse). Bounce an unverified master straight to the verify modal
    // instead of firing a doomed request — but ask the server first, because a
    // cached `false` outlives a verification done in the mail app's browser.
    if (!(await ensureEmailVerified())) {
      setEmailGateOpen(true);
      return;
    }
    try {
      const { url, revoke } = await estimatesApi.fetchPdf(id);
      window.open(url, '_blank');
      setTimeout(revoke, 60_000);
    } catch (err) {
      if (toAppError(err).code === 'EMAIL_NOT_VERIFIED') {
        setEmailGateOpen(true);
      } else {
        toast.error(t('estimate.pdfFailed'));
      }
    }
  };

  const onShare = async () => {
    // Sharing reaches a client and requires a verified email — check upfront so an
    // unverified master gets the verify prompt immediately, not a share dialog that
    // dead-ends on every option. Confirmed against the server, see useEmailGate.
    if (!(await ensureEmailVerified())) {
      setEmailGateOpen(true);
      return;
    }
    setShareOpen(true);
  };

  const openEdit = () => {
    setRenameValue(est.name ?? '');
    setEditOpen(true);
  };

  // Name + deposit share one PUT — always send BOTH so saving one never clears
  // the other. Name edits keep the current deposit; deposit edits keep the name.
  const saveName = async () => {
    try {
      await updateEstimate.mutateAsync({
        status: est.status,
        validUntil: est.validUntil ?? undefined,
        notes: est.notes ?? undefined,
        name: renameValue.trim() || undefined,
        depositAmount: est.depositAmount ?? null,
      });
      toast.success(t('estimate.saved'));
      setEditOpen(false);
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const openDeposit = () => {
    setDepositValue(est.depositAmount != null ? String(est.depositAmount) : '');
    setDepositOpen(true);
  };

  const saveDeposit = async (clear = false) => {
    try {
      await updateEstimate.mutateAsync({
        status: est.status,
        validUntil: est.validUntil ?? undefined,
        notes: est.notes ?? undefined,
        name: est.name ?? undefined,
        depositAmount: clear || depositValue.trim() === '' ? null : parseDecimal(depositValue),
      });
      toast.success(t('estimate.saved'));
      setDepositOpen(false);
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  // Saving as a template reads the estimate's items on the server — online-only.
  const openSaveTemplate = guard(() => {
    setTemplateName(est.name ?? '');
    setSaveTemplateOpen(true);
  });

  const saveTemplate = async () => {
    if (!templateName.trim()) return;
    try {
      await saveAsTemplate.mutateAsync({ name: templateName.trim(), trade: templateTrade });
      toast.success(t('templates.saved'));
      setSaveTemplateOpen(false);
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const confirmDeleteItem = async () => {
    if (!deletingItem) return;
    try {
      await removeItem.mutateAsync(deletingItem.id);
      toast.success(t('estimate.deleted'));
      setEditing(null); // close the edit form only after a successful delete
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setDeletingItem(null);
    }
  };

  const confirmDelete = async () => {
    try {
      await deleteEstimate.mutateAsync();
      toast.success(t('estimate.estimateDeleted'));
      void navigate(projectId ? routes.project(projectId) : routes.projects, { replace: true });
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const confirmReopen = async () => {
    try {
      await reopenEstimate.mutateAsync();
      toast.success(t('estimate.reopened'));
      setReopenConfirmOpen(false);
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const runFab = (fn: () => void) => {
    setFabOpen(false);
    fn();
  };

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto max-w-app px-4 pb-44 pt-4 sm:px-6 lg:px-8 lg:pb-10">
        {/* Header */}
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            aria-label={t('common.back')}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-lg text-primary"
          >
            ←
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-bold text-primary">
              {estimateName(est.name, est.createdAt)}
            </div>
            <div className="truncate text-xs text-muted">
              {project.data ? project.data.name : t('estimate.autosaved')}
            </div>
          </div>
          <Badge variant={ESTIMATE_STATUS_VARIANT[est.status]}>
            {t('status.estimate.' + est.status)}
          </Badge>
          {!signed && (
            <button
              type="button"
              onClick={openEdit}
              aria-label={t('estimate.edit')}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-base leading-none text-primary"
            >
              ✏️
            </button>
          )}
        </div>

        {signed && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-card border border-border bg-brand-soft px-3.5 py-3">
            <span className="flex-1 text-sm font-semibold text-primary">
              {t('estimate.signedViewOnly')}
            </span>
            <Button variant="secondary" onClick={() => setReopenConfirmOpen(true)}>
              {t('estimate.reopen')}
            </Button>
          </div>
        )}

        {/* Client banner */}
        {project.data && <ClientBanner project={project.data} />}

        {/* Items + summary (two columns on desktop) */}
        <div className="lg:grid lg:grid-cols-[1.7fr_1fr] lg:items-start lg:gap-5">
          <div>
            {est.items.length === 0 ? (
              <EmptyState
                icon="🧾"
                title={t('estimate.emptyTitle')}
                text={t('estimate.emptyText')}
                action={
                  <Button onClick={() => setAddOpen(true)} disabled={signed}>
                    {t('estimate.addItem')}
                  </Button>
                }
              />
            ) : (
              <>
                {groups.map(([category, items]) => (
                <section key={category} className="mb-4">
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-brand">
                    <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                    {category}
                  </div>
                  <div className="space-y-1.5">
                    {items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => !signed && setEditing(item)}
                        disabled={signed}
                        title={signed ? t('estimate.signedNoEdit') : undefined}
                        className="w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-left transition-transform disabled:cursor-default active:scale-[0.99] disabled:active:scale-100"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-medium text-primary">{item.name}</span>
                          <span className="whitespace-nowrap text-sm font-bold text-primary">
                            {formatMoney(item.lineTotal)}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                          <span>
                            {formatNumber(item.quantity, 3)} {t('units.' + item.unit)}
                          </span>
                          <span className="h-[3px] w-[3px] rounded-full bg-faint" />
                          <span>
                            {formatMoney(item.unitPrice)}/{t('units.' + item.unit)}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
                ))}
                {!signed && (
                  <button
                    type="button"
                    onClick={() => setAddOpen(true)}
                    className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-brand py-3 text-sm font-semibold text-brand"
                  >
                    {t('estimate.addItem')}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Desktop summary */}
          <div className="hidden lg:sticky lg:top-8 lg:block">
            <SummaryCard
              est={est}
              project={project.data}
              onEditDeposit={signed ? undefined : openDeposit}
            />
          </div>
        </div>
      </div>

      {/* Mobile sticky total bar — totals only; actions live in the FAB */}
      <div className="fixed inset-x-0 bottom-0 z-40 bg-ink px-5 pb-7 pt-3.5 text-white lg:hidden">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs text-white/60">{t('estimate.toPay')}</div>
            <div data-testid="estimate-total" className="text-2xl font-extrabold tracking-tight">
              {formatMoney(est.total)}
            </div>
          </div>
          <div className="text-right text-[11px] text-white/55">
            {t('estimate.works')}: {formatMoney(est.worksSubtotal)}
            <br />
            {t('estimate.materials')}: {formatMoney(est.materialsSubtotal)}
          </div>
        </div>
        <DepositRow est={est} onEdit={signed ? undefined : openDeposit} />
      </div>

      {/* Floating actions (speed-dial) — always in reach on every screen size */}
      {fabOpen && (
        <button
          type="button"
          aria-label={t('common.close')}
          className="fixed inset-0 z-40 cursor-default"
          onClick={() => setFabOpen(false)}
        />
      )}
      <div className="fixed bottom-32 right-4 z-50 flex flex-col items-end gap-2 lg:bottom-8 lg:right-8">
        {fabOpen && (
          <>
            {!signed && (
              <FabAction icon="＋" label={t('estimate.addItemTitle')} onClick={() => runFab(() => setAddOpen(true))} />
            )}
            {!signed && (
              <FabAction
                icon="🧾"
                label={t('receipt.fabLabel')}
                onClick={() =>
                  runFab(guard(() => { // LLM recognition — server-side, no offline path
                    if (isPro) {
                      setReceiptOpen(true);
                    } else {
                      void upgradeApi.click('RECEIPT_IMPORT');
                      setUpgradeOpen(true);
                    }
                  }))
                }
              />
            )}
            {/* Online-only: both reach the server (a rendered PDF / a link sent to a client). */}
            <FabAction icon="📤" label={t('estimate.shareWithClientBtn')} onClick={() => runFab(guard(() => void onShare()))} />
            <FabAction icon="📄" label={t('estimate.generatePdf')} onClick={() => runFab(guard(() => void onPdf()))} />
            {est.items.length > 0 && (
              <FabAction icon="📋" label={t('templates.saveAsTemplate')} onClick={() => runFab(openSaveTemplate)} />
            )}
          </>
        )}
        <button
          type="button"
          onClick={() => setFabOpen((o) => !o)}
          aria-label={t('estimate.actionsMenu')}
          aria-expanded={fabOpen}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-card-lg transition-transform active:scale-95"
        >
          <span className={cn('text-3xl leading-none transition-transform', fabOpen && 'rotate-45')}>＋</span>
        </button>
      </div>

      <EmailVerifyModal open={emailGateOpen} onClose={() => setEmailGateOpen(false)} />
      {project.data && (
        <SharePortalSheet
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          project={project.data}
          preselectEstimateId={id}
          onNeedEmailVerify={() => setEmailGateOpen(true)}
        />
      )}

      <AddItemSheet
        estimateId={id}
        objectId={signed ? undefined : projectId}
        nextSortOrder={nextSortOrder}
        open={addOpen}
        onClose={() => setAddOpen(false)}
      />

      {projectId && (
        <ReceiptImportSheet
          open={receiptOpen}
          onClose={() => setReceiptOpen(false)}
          estimateId={id}
          projectId={projectId}
        />
      )}
      <UpgradeIntentModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={t('estimate.editItem')}>
        {editing && (
          <ItemForm
            key={editing.id}
            initial={editing}
            objectId={signed ? undefined : projectId}
            submitLabel={t('common.save')}
            submitting={updateItem.isPending}
            deleting={removeItem.isPending}
            onSubmit={async (req) => {
              try {
                await updateItem.mutateAsync({ itemId: editing.id, req });
                toast.success(t('estimate.saved'));
                setEditing(null);
              } catch (err) {
                toast.error(toAppError(err).message);
              }
            }}
            onDelete={() => {
              // Ask before deleting, but KEEP the edit form open (the confirm
              // stacks on top): Cancel returns to it with the user's changes
              // intact; only a confirmed delete closes it.
              setDeletingItem(editing);
            }}
          />
        )}
      </Modal>

      {/* Edit estimate (pencil) — rename + delete only. */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={t('estimate.editTitle')}>
        <label htmlFor="est-name" className="mb-1.5 block text-[13px] font-semibold text-muted">
          {t('estimate.nameLabel')}
        </label>
        <Input
          id="est-name"
          value={renameValue}
          maxLength={255}
          placeholder={t('estimate.namePlaceholder')}
          onChange={(e) => setRenameValue(e.target.value)}
        />
        <Button fullWidth loading={updateEstimate.isPending} onClick={saveName} className="mt-3">
          {t('common.save')}
        </Button>
        <button
          type="button"
          onClick={() => {
            setEditOpen(false);
            setDeleteConfirmOpen(true);
          }}
          className="mt-4 w-full rounded-lg border border-danger/40 py-2.5 text-sm font-semibold text-danger"
        >
          {t('estimate.deleteEstimate')}
        </button>
      </Modal>

      {/* Deposit — edited here from the summary card / total bar. */}
      <Modal open={depositOpen} onClose={() => setDepositOpen(false)} title={t('estimate.depositTitle')}>
        <label htmlFor="est-deposit" className="mb-1.5 block text-[13px] font-semibold text-muted">
          {t('estimate.depositLabel')}
        </label>
        <Input
          id="est-deposit"
          inputMode="decimal"
          value={depositValue}
          placeholder="0"
          onChange={(e) => setDepositValue(e.target.value)}
        />
        <div className="mt-4 flex gap-2">
          {est.depositAmount != null && (
            <Button
              variant="secondary"
              fullWidth
              loading={updateEstimate.isPending}
              onClick={() => void saveDeposit(true)}
            >
              {t('estimate.depositRemove')}
            </Button>
          )}
          <Button fullWidth loading={updateEstimate.isPending} onClick={() => void saveDeposit()}>
            {t('common.save')}
          </Button>
        </div>
      </Modal>

      <Modal
        open={saveTemplateOpen}
        onClose={() => setSaveTemplateOpen(false)}
        title={t('templates.saveAsTemplate')}
      >
        <p className="mb-3 text-sm text-muted">{t('templates.saveAsTemplatePrompt')}</p>
        <Input
          value={templateName}
          maxLength={255}
          placeholder={t('templates.namePlaceholder')}
          onChange={(e) => setTemplateName(e.target.value)}
          className="mb-3"
        />
        <div className="mb-4">
          <TradeSelect value={templateTrade} onChange={setTemplateTrade} label={t('templates.tradeLabel')} />
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" fullWidth onClick={() => setSaveTemplateOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button fullWidth loading={saveAsTemplate.isPending} onClick={saveTemplate}>
            {t('common.save')}
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteConfirmOpen}
        title={t('estimate.deleteEstimate')}
        message={t('estimate.deleteConfirm')}
        confirmLabel={t('common.delete')}
        loading={deleteEstimate.isPending}
        onConfirm={confirmDelete}
        onClose={() => setDeleteConfirmOpen(false)}
      />

      <ConfirmDialog
        open={reopenConfirmOpen}
        title={t('estimate.reopen')}
        message={t('estimate.reopenConfirm')}
        confirmLabel={t('estimate.reopen')}
        loading={reopenEstimate.isPending}
        onConfirm={confirmReopen}
        onClose={() => setReopenConfirmOpen(false)}
      />

      <ConfirmDialog
        open={deletingItem !== null}
        title={t('estimate.deleteItemTitle')}
        message={t('estimate.deleteItemConfirm', { name: deletingItem?.name ?? '' })}
        confirmLabel={t('common.delete')}
        loading={removeItem.isPending}
        onConfirm={confirmDeleteItem}
        onClose={() => setDeletingItem(null)}
      />
    </div>
  );
}

function FabAction({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-full bg-surface py-2.5 pl-4 pr-5 text-sm font-semibold text-primary shadow-card-lg active:scale-95"
    >
      <span className="text-base leading-none">{icon}</span>
      {label}
    </button>
  );
}

/** Deposit line for the mobile total bar: shows завдаток/залишок or an "add
 *  deposit" affordance; tapping opens the deposit editor. Read-only when signed. */
function DepositRow({ est, onEdit }: { est: EstimateResponse; onEdit?: () => void }) {
  const { t } = useTranslation();
  if (est.depositAmount == null && !onEdit) return null;

  const content =
    est.depositAmount != null ? (
      <>
        <span className="text-white/70">
          {t('estimate.deposit')}: {formatMoney(est.depositAmount)}
        </span>
        <span className="font-semibold text-white">
          {t('estimate.balance')}: {formatMoney(est.balance)}
        </span>
      </>
    ) : (
      <span className="font-semibold text-brand">＋ {t('estimate.depositAdd')}</span>
    );

  const cls = 'mt-2 flex w-full items-center justify-between border-t border-white/10 pt-2 text-[12px]';
  return onEdit ? (
    <button type="button" onClick={onEdit} className={cls}>
      {content}
    </button>
  ) : (
    <div className={cls}>{content}</div>
  );
}

function ClientBanner({ project }: { project: ProjectResponse }) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 flex items-center gap-3 rounded-card border border-brand-soft-2 bg-gradient-to-br from-brand-soft to-brand-soft-2 p-3.5">
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
        {initials(project.clientFullName) || '🏠'}
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-primary">
          {project.clientFullName ?? t('estimate.noClient')}
        </div>
        <div className="truncate text-xs text-ink-2/70">{project.address}</div>
      </div>
    </div>
  );
}

function SummaryCard({
  est,
  project,
  onEditDeposit,
}: {
  est: EstimateResponse;
  project: ProjectResponse | undefined;
  /** Undefined when the estimate is signed (read-only) — hides deposit editing. */
  onEditDeposit?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-card bg-ink p-5 text-white">
      {project && (
        <div className="mb-4 flex items-center gap-2.5 border-b border-white/10 pb-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-[13px] font-bold">
            {initials(project.clientFullName) || '🏠'}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {project.clientFullName ?? t('estimate.noClient')}
            </div>
            <div className="truncate text-xs text-white/60">{project.name}</div>
          </div>
        </div>
      )}
      <div className="mb-2.5 flex justify-between text-[13px] text-white/75">
        <span>{t('estimate.works')}</span>
        <span>{formatMoney(est.worksSubtotal)}</span>
      </div>
      <div className="mb-2.5 flex justify-between text-[13px] text-white/75">
        <span>{t('estimate.materials')}</span>
        <span>{formatMoney(est.materialsSubtotal)}</span>
      </div>
      <div className="mt-1 border-t border-white/10 pt-3 text-[13px] font-semibold">{t('estimate.toPay')}</div>
      <div data-testid="estimate-total" className="my-1.5 text-2xl font-extrabold tracking-tight">
        {formatMoney(est.total)}
      </div>
      {est.depositAmount != null ? (
        <div className="mt-2 border-t border-white/10 pt-2">
          <div className="flex justify-between text-[13px] text-white/75">
            <span>{t('estimate.deposit')}</span>
            <span>{formatMoney(est.depositAmount)}</span>
          </div>
          <div className="flex justify-between text-[13px] font-semibold text-white">
            <span>{t('estimate.balance')}</span>
            <span>{formatMoney(est.balance)}</span>
          </div>
          {onEditDeposit && (
            <button type="button" onClick={onEditDeposit} className="mt-2 text-xs font-semibold text-brand">
              {t('estimate.depositEdit')}
            </button>
          )}
        </div>
      ) : (
        onEditDeposit && (
          <button
            type="button"
            onClick={onEditDeposit}
            className="mt-3 w-full rounded-[10px] border border-white/25 py-2.5 text-sm font-semibold text-white hover:bg-white/[0.08]"
          >
            ＋ {t('estimate.depositAdd')}
          </button>
        )
      )}
    </div>
  );
}
