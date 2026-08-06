import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/Badge.tsx';
import { Button } from '@/components/Button.tsx';
import { Modal } from '@/components/Modal.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { IconTile } from '@/components/IconTile.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { ErrorState } from '@/components/ErrorState.tsx';
import { UpgradeBanner } from '@/components/UpgradeBanner.tsx';
import { usePlanLimits, isAtLimit } from '@/features/plan/usePlanLimits.ts';
import { EmailVerifyModal } from '@/features/email/EmailVerifyModal.tsx';
import { estimatesApi } from '@/api/estimates.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { formatMoney, initials } from '@/lib/format.ts';
import { cn } from '@/lib/cn.ts';
import { ESTIMATE_STATUS_VARIANT, PROJECT_STATUS_VARIANT } from '@/lib/labels.ts';
import { ActionMenu, ActionMenuItem } from '@/components/ActionMenu.tsx';
import { economyPairHint } from './economyNote.ts';
import { routes } from '@/lib/config.ts';
import type { EstimateSummary, EstimateTemplateSummary } from '@/api/types.ts';
import { useProject } from './useProjects.ts';
import { useEstimate, useCreateEstimate } from '@/features/estimate/useEstimate.ts';
import { estimateName } from '@/features/estimate/estimateName.ts';
import { SharePortalSheet } from './SharePortalSheet.tsx';
import { ConsolidateSheet } from '@/features/estimate/ConsolidateSheet.tsx';
import { TemplatePickerSheet } from '@/features/estimate/TemplatePickerSheet.tsx';
import { PhotosSection } from '@/features/photos/PhotosSection.tsx';
import { TemplateNotCachedError, useApplyTemplate } from '@/features/estimate/useEstimateTemplates.ts';
import { ClientEditModal } from '@/features/clients/ClientEditModal.tsx';
import { MessagesSection } from '@/features/messages/MessagesSection.tsx';
import { ChatLinkSheet } from '@/features/messages/ChatLinkSheet.tsx';
import { Fab, FabAction } from '@/components/Fab.tsx';
import { ObjectEconomySection } from '@/features/economy/ObjectEconomySection.tsx';
import { MeasurementsSection } from '@/features/measurements/MeasurementsSection.tsx';
import { NotesSection } from '@/features/notes/NotesSection.tsx';
import { useMe } from '@/features/auth/useMe.ts';
import { useOnlineGuard } from '@/hooks/useOnlineGuard.ts';

type Tab = 'estimate' | 'measurements' | 'photos' | 'notes' | 'act';
const TABS: { key: Tab; labelKey: string; shortLabelKey?: string }[] = [
  { key: 'estimate', labelKey: 'projects.tabEstimate' },
  { key: 'measurements', labelKey: 'projects.tabMeasurements' },
  { key: 'photos', labelKey: 'projects.tabPhotos' },
  { key: 'notes', labelKey: 'projects.tabNotes' },
  { key: 'act', labelKey: 'projects.tabAct', shortLabelKey: 'projects.tabActShort' },
];

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isPro = (me?.plan ?? 'FREE') !== 'FREE';
  const { guard } = useOnlineGuard(); // for the server-only actions (portal share)
  const project = useProject(id);
  const [tab, setTab] = useState<Tab>('estimate');
  const [shareOpen, setShareOpen] = useState(false);
  const [chatLinkOpen, setChatLinkOpen] = useState(false);
  const [emailGateOpen, setEmailGateOpen] = useState(false);
  const [editClientOpen, setEditClientOpen] = useState(false);
  // The action a row asked for, waiting on its confirm dialog.
  const [confirm, setConfirm] = useState<{ kind: 'delete' | 'reopen'; est: EstimateSummary } | null>(null);

  const estimates = useQuery({
    queryKey: ['project-estimates', id],
    queryFn: () => estimatesApi.listForProject(id),
    enabled: Boolean(id),
  });
  const limits = usePlanLimits();

  const invalidateAfterRowAction = () => {
    void qc.invalidateQueries({ queryKey: ['project-estimates', id] });
    void qc.invalidateQueries({ queryKey: ['projects'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    setConfirm(null);
  };
  // Row-level delete / reopen reuse the SAME backend logic as the in-estimate
  // actions — just a second access point. id is passed at mutate time (per row).
  const rowDelete = useMutation({
    mutationFn: (estId: string) => estimatesApi.remove(estId),
    onSuccess: () => {
      invalidateAfterRowAction();
      toast.success(t('estimate.estimateDeleted'));
    },
    onError: (err) => toast.error(toAppError(err).message),
  });
  const rowReopen = useMutation({
    mutationFn: (estId: string) => estimatesApi.reopen(estId),
    onSuccess: () => {
      invalidateAfterRowAction();
      toast.success(t('estimate.reopened'));
    },
    onError: (err) => toast.error(toAppError(err).message),
  });
  const rowEconomyToggle = useMutation({
    mutationFn: (v: { estId: string; value: boolean }) => estimatesApi.setCountInEconomy(v.estId, v.value),
    onSuccess: () => {
      invalidateAfterRowAction();
      void qc.invalidateQueries({ queryKey: ['object-economy', id] });
    },
    onError: (err) => toast.error(toAppError(err).message),
  });

  // Offline-first (useCreateEstimate handles optimistic cache + queueing); we just navigate.
  const createEstimate = useCreateEstimate();
  const createEmptyEstimate = () =>
    createEstimate.mutate(
      { projectId: id, req: {} },
      {
        onSuccess: (e) => { void navigate(routes.estimate(e.id)); },
        onError: (err) => toast.error(toAppError(err).message),
      },
    );

  // New estimate here is a choice: empty, or start from a template (defaults +
  // own). Applying a template reuses the backend apply-to-project endpoint.
  const applyTemplate = useApplyTemplate();
  const [estimateChoiceOpen, setEstimateChoiceOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [consolidateOpen, setConsolidateOpen] = useState(false);

  if (project.isPending) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center text-brand">
        <Spinner size="lg" />
      </div>
    );
  }
  // Data first: a failed offline refetch must not hide an object we still have cached.
  if (!project.data) {
    // Transient failure (offline / backend down / 5xx) is NOT "не знайдено" —
    // offer a retry instead of suggesting the project doesn't exist.
    const status = project.error ? toAppError(project.error).status : 404;
    if (project.isError && status !== 404 && status !== 403) {
      return (
        <ErrorState
          error={project.error}
          what={t('offline.dataProject')}
          onRetry={() => void project.refetch()}
        />
      );
    }
    return (
      <EmptyState
        icon="⚠️"
        title={t('projects.notFoundTitle')}
        action={<Button onClick={() => navigate(routes.projects)}>{t('projects.toList')}</Button>}
      />
    );
  }

  const p = project.data;
  const list = estimates.data ?? [];
  // FREE caps estimates per project (closes the unlimited-drafts hole). Block
  // "new estimate" preemptively once this project hits the cap; deleting one
  // frees a slot (count is live). Backend still enforces it.
  const atEstimateLimit = isAtLimit(list.length, limits.data?.maxEstimatesPerProject);
  const addEstimate = () => {
    if (atEstimateLimit || createEstimate.isPending || applyTemplate.isPending) return;
    setEstimateChoiceOpen(true);
  };
  const createEmpty = () => {
    setEstimateChoiceOpen(false);
    createEmptyEstimate();
  };
  // Works offline: `useApplyTemplate` composes the estimate on the device from the cached
  // template and catalog (same name-matching rule as the server) and queues it. This is the
  // second entry point for that action — the wizard has the other one, and both must behave
  // the same, or the master just meets the wall from a different screen.
  const onPickTemplate = async (tpls: EstimateTemplateSummary[]) => {
    setTemplatePickerOpen(false);
    setEstimateChoiceOpen(false);
    try {
      const e = await applyTemplate.mutateAsync({
        projectId: id, templateIds: tpls.map((tpl) => tpl.id), req: {},
      });
      void qc.invalidateQueries({ queryKey: ['project-estimates', id] });
      void navigate(routes.estimate(e.id));
    } catch (err) {
      toast.error(err instanceof TemplateNotCachedError
        ? t('offline.templateNotCached')
        : toAppError(err).message);
    }
  };
  // Sharing mints a portal link on the server — online-only, so say so plainly when offline.
  const openShare = guard(() => {
    if (list.length === 0) {
      toast.info(t('projects.createEstimateFirst'));
      return;
    }
    setShareOpen(true);
  });

  return (
    <>
      <EmailVerifyModal open={emailGateOpen} onClose={() => setEmailGateOpen(false)} />
      <SharePortalSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        project={p}
        onNeedEmailVerify={() => setEmailGateOpen(true)}
      />
      {p.clientId && (
        <ClientEditModal
          open={editClientOpen}
          onClose={() => setEditClientOpen(false)}
          clientId={p.clientId}
        />
      )}


      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'reopen' ? t('estimate.reopen') : t('estimate.deleteEstimate')}
        message={confirm?.kind === 'reopen' ? t('estimate.reopenConfirm') : t('estimate.deleteConfirm')}
        confirmLabel={confirm?.kind === 'reopen' ? t('estimate.reopen') : t('common.delete')}
        loading={rowDelete.isPending || rowReopen.isPending}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === 'reopen') rowReopen.mutate(confirm.est.id);
          else rowDelete.mutate(confirm.est.id);
        }}
        onClose={() => setConfirm(null)}
      />

      <Modal
        open={estimateChoiceOpen}
        onClose={() => setEstimateChoiceOpen(false)}
        title={t('templates.chooseType')}
      >
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={createEmpty} loading={createEstimate.isPending}>
              {t('templates.emptyEstimate')}
            </Button>
            <Button
              onClick={() => {
                setEstimateChoiceOpen(false);
                setTemplatePickerOpen(true);
              }}
            >
              {t('templates.fromTemplate')}
            </Button>
          </div>
          {/* Import a ready estimate onto this object (Excel/photo → LLM, PRO). */}
          <Button
            fullWidth
            variant="secondary"
            onClick={() => {
              setEstimateChoiceOpen(false);
              void navigate(routes.importEstimate(id));
            }}
          >
            {t('templates.fromFile')}
          </Button>
        </div>
      </Modal>

      <TemplatePickerSheet
        open={templatePickerOpen}
        onClose={() => setTemplatePickerOpen(false)}
        onPick={onPickTemplate}
        applying={applyTemplate.isPending}
      />

      <ConsolidateSheet
        open={consolidateOpen}
        onClose={() => setConsolidateOpen(false)}
        projectId={id}
        estimates={list}
        onDone={(newId) => {
          setConsolidateOpen(false);
          void qc.invalidateQueries({ queryKey: ['project-estimates', id] });
          void qc.invalidateQueries({ queryKey: ['projects'] });
          void navigate(routes.estimate(newId));
        }}
      />

      <div className="mb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(routes.projects)}
          aria-label={t('common.back')}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-sunken text-lg text-primary"
        >
          ←
        </button>
        <span className="text-sm text-muted">{t('projects.detailLabel')}</span>
      </div>

      {/* Hero */}
      <div className="mb-4 rounded-card border border-border bg-surface-sunken p-4">
        <div className="mb-1.5 flex items-center gap-2 text-[17px] font-bold text-primary">
          <IconTile tone="brand" size={32}>
            📁
          </IconTile>
          <span className="min-w-0 truncate">{p.name}</span>
        </div>
        <div className="mb-3 text-xs text-muted">📍 {p.address}</div>
        <Badge variant={PROJECT_STATUS_VARIANT[p.status]}>{t('status.project.' + p.status)}</Badge>
        {p.clientFullName && (
          <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-[11px] font-bold text-brand">
              {initials(p.clientFullName)}
            </span>
            <span className="text-xs text-primary">
              <strong className="font-semibold">{p.clientFullName}</strong>
            </span>
            {p.clientId && (
              <button
                type="button"
                onClick={() => setEditClientOpen(true)}
                className="ml-auto text-xs font-semibold text-brand"
              >
                {t('common.edit')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1.5 border-b border-border">
        {TABS.map((tabItem) => (
          <button
            key={tabItem.key}
            type="button"
            onClick={() => setTab(tabItem.key)}
            className={
              'flex-1 border-b-2 py-2.5 text-center text-[13px] font-semibold transition-colors ' +
              (tab === tabItem.key
                ? 'border-brand text-brand'
                : 'border-transparent text-muted')
            }
          >
            {tabItem.shortLabelKey ? (
              <>
                {/* «Економіка об'єкту» doesn't fit five 375px tabs — phones get the short form. */}
                <span className="sm:hidden">{t(tabItem.shortLabelKey)}</span>
                <span className="hidden sm:inline">{t(tabItem.labelKey)}</span>
              </>
            ) : (
              t(tabItem.labelKey)
            )}
          </button>
        ))}
      </div>

      {tab === 'measurements' ? (
        <MeasurementsSection objectId={id} />
      ) : tab === 'photos' ? (
        <PhotosSection projectId={id} />
      ) : tab === 'notes' ? (
        <NotesSection objectId={id} />
      ) : tab === 'act' ? (
        <ObjectEconomySection objectId={id} />
      ) : (
        <>
          {/* The two share links used to be full-width cards here. On a phone they pushed the
              estimates below the fold for actions taken once a job, so they moved into the FAB. */}
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-bold uppercase tracking-wide text-primary">
              {t('projects.estimatesCount', { count: list.length })}
            </h2>
            <div className="flex items-center gap-3">
              {list.length >= 2 && (
                <button
                  type="button"
                  onClick={() => setConsolidateOpen(true)}
                  disabled={atEstimateLimit}
                  title={atEstimateLimit ? t('limits.atLimitTooltip') : undefined}
                  className="text-[13px] font-semibold text-brand disabled:opacity-60"
                >
                  {t('consolidate.addButton')}
                </button>
              )}
              <button
                type="button"
                onClick={addEstimate}
                disabled={createEstimate.isPending || atEstimateLimit}
                title={atEstimateLimit ? t('limits.atLimitTooltip') : undefined}
                className="text-[13px] font-semibold text-brand disabled:opacity-60"
              >
                {t('projects.addNew')}
              </button>
            </div>
          </div>

          {atEstimateLimit && (
            <UpgradeBanner
              text={t('limits.estimatesHint', { max: limits.data?.maxEstimatesPerProject })}
              trigger="ESTIMATE_LIMIT"
            />
          )}

          {estimates.isPending ? (
            <p className="py-6 text-center text-sm text-muted">{t('common.loading')}</p>
          ) : list.length === 0 ? (
            <EmptyState
              icon="🧾"
              title={t('projects.noEstimatesTitle')}
              text={t('projects.noEstimatesText')}
              action={
                <Button
                  onClick={addEstimate}
                  loading={createEstimate.isPending || applyTemplate.isPending}
                >
                  {t('common.newEstimate')}
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {list.map((s) => (
                <EstimateRow
                  key={s.id}
                  summary={s}
                  economyLocked={!isPro}
                  // A handful of estimates per object, so a scan beats memoising a Set.
                  isCrewSource={list.some((other) => other.duplicatedFromId === s.id)}
                  onClick={() => navigate(routes.estimate(s.id))}
                  onReopen={() => setConfirm({ kind: 'reopen', est: s })}
                  onDelete={() => setConfirm({ kind: 'delete', est: s })}
                  onToggleEconomy={(value) => rowEconomyToggle.mutate({ estId: s.id, value })}
                />
              ))}
            </div>
          )}
        </>
      )}

      <MessagesSection projectId={id} />

      <ChatLinkSheet
        open={chatLinkOpen}
        onClose={() => setChatLinkOpen(false)}
        projectId={id}
        allowRevoke
      />

      {/* The object's two share links. Both reach the server to mint or publish, so both go through
          `guard` — offline they say so rather than failing silently. */}
      <Fab ariaLabel={t('projects.actionsMenu')}>
        {(close) => (
          <>
            <FabAction
              icon="📤"
              label={t('projects.shareWithClient')}
              onClick={() => close(openShare)}
            />
            <FabAction
              icon="💬"
              label={t('messageLink.title')}
              onClick={() => close(guard(() => setChatLinkOpen(true)))}
            />
          </>
        )}
      </Fab>
    </>
  );
}

/** Loads the full estimate to show the backend-computed total + item count.
 *  A separate ⋮ button opens quick actions (delete / reopen) — kept outside the
 *  row's main button to avoid invalid nested buttons. */
function EstimateRow({
  summary,
  economyLocked,
  isCrewSource,
  onClick,
  onReopen,
  onDelete,
  onToggleEconomy,
}: {
  summary: EstimateSummary;
  economyLocked: boolean;
  /** True when a marked-up copy of this estimate exists — i.e. this is the crew's price list. */
  isCrewSource: boolean;
  onClick: () => void;
  onReopen: () => void;
  onDelete: () => void;
  onToggleEconomy: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const full = useEstimate(summary.id);
  // FREE can't use the economy, so its checkbox reads unchecked (and is disabled).
  // On PRO it shows the real stored flag — default-on for every estimate except a
  // consolidated one — so upgrading immediately reflects them all in the economy.
  const checked = economyLocked ? false : summary.countInEconomy;
  const pairHint = economyPairHint(summary, isCrewSource);
  return (
    <div className="rounded-card border border-border bg-surface">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={onClick}
          className="min-w-0 flex-1 px-3.5 py-3 text-left transition-transform active:scale-[0.99]"
        >
          {/* The name wraps instead of truncating — what tells «Зведений кошторис» from «Зведений
              кошторис +15%» is at the end, and on a phone that is precisely what the ellipsis ate.
              items-start keeps the total on the first line while the name grows downward. */}
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 break-words text-sm font-medium leading-snug text-primary">
              {estimateName(summary.name, summary.createdAt)}
            </span>
            <span className="whitespace-nowrap text-sm font-bold text-primary">
              {full.data ? formatMoney(full.data.total) : '—'}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <Badge variant={ESTIMATE_STATUS_VARIANT[summary.status]}>
              {t('status.estimate.' + summary.status)}
            </Badge>
            <span className="ml-auto text-xs text-muted">
              {full.data ? t('projects.itemsCount', { count: full.data.items.length }) : '…'}
            </span>
          </div>
        </button>
        <ActionMenu ariaLabel={t('estimate.actions')}>
          {(close) =>
            summary.status === 'SIGNED' ? (
              <ActionMenuItem
                icon="🔓"
                label={t('estimate.reopen')}
                onClick={() => { close(); onReopen(); }}
              />
            ) : (
              <ActionMenuItem
                icon="🗑"
                danger
                label={t('estimate.deleteEstimate')}
                onClick={() => { close(); onDelete(); }}
              />
            )
          }
        </ActionMenu>
      </div>
      {/* Visible economy checkbox — much clearer than hiding it in the ⋮ menu.
          FREE can't see the object economy, so it's disabled (kept, not removed).
          Generous 44px tap target — the old one was hard to hit on a phone. */}
      <button
        type="button"
        disabled={economyLocked}
        aria-checked={checked}
        role="checkbox"
        onClick={() => onToggleEconomy(!checked)}
        className={cn(
          'flex min-h-[44px] w-full items-center gap-2.5 border-t border-border px-3.5 py-2.5 text-left',
          economyLocked ? 'cursor-not-allowed opacity-55' : 'active:bg-surface-sunken',
        )}
      >
        <span
          className={cn(
            'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border text-xs',
            checked ? 'border-brand bg-brand text-white' : 'border-border text-transparent',
          )}
        >
          ✓
        </span>
        <span className={cn('text-xs', checked ? 'font-semibold text-primary' : 'text-muted')}>
          {t('estimate.countInEconomy')}
        </span>
        {economyLocked && <span className="ml-auto text-xs text-muted">🔒 PRO</span>}
      </button>
      {/* Outside the button on purpose. Inside it, the note dimmed along with an un-ticked box and
          read as "true only while the tick is on" — but it describes the standing arrangement of a
          duplicated pair, which holds either way. */}
      {pairHint && (
        <p className="border-t border-border px-3.5 py-2 text-[11px] leading-snug text-muted">
          ℹ️ {t(pairHint, { percent: Math.abs(summary.markupPercent ?? 0) })}
        </p>
      )}
    </div>
  );
}
