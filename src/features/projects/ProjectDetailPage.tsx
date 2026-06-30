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
import { ESTIMATE_STATUS_VARIANT, PROJECT_STATUS_VARIANT } from '@/lib/labels.ts';
import { routes } from '@/lib/config.ts';
import type { EstimateSummary, EstimateTemplateSummary } from '@/api/types.ts';
import { useProject } from './useProjects.ts';
import { useEstimate } from '@/features/estimate/useEstimate.ts';
import { estimateName } from '@/features/estimate/estimateName.ts';
import { ShareEstimateSheet } from '@/features/estimate/ShareEstimateSheet.tsx';
import { TemplatePickerSheet } from '@/features/estimate/TemplatePickerSheet.tsx';
import { useApplyTemplate } from '@/features/estimate/useEstimateTemplates.ts';
import { ClientEditModal } from '@/features/clients/ClientEditModal.tsx';
import { QuestionsSection } from '@/features/questions/QuestionsSection.tsx';

type Tab = 'estimate' | 'photos' | 'changes' | 'act';
const TABS: { key: Tab; labelKey: string }[] = [
  { key: 'estimate', labelKey: 'projects.tabEstimate' },
  { key: 'photos', labelKey: 'projects.tabPhotos' },
  { key: 'changes', labelKey: 'projects.tabChanges' },
  { key: 'act', labelKey: 'projects.tabAct' },
];

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const project = useProject(id);
  const [tab, setTab] = useState<Tab>('estimate');
  const [shareOpen, setShareOpen] = useState(false);
  const [emailGateOpen, setEmailGateOpen] = useState(false);
  const [editClientOpen, setEditClientOpen] = useState(false);
  // Quick actions menu on an estimate row, and the resulting confirm dialog.
  const [menuFor, setMenuFor] = useState<EstimateSummary | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'delete' | 'reopen'; est: EstimateSummary } | null>(null);

  const estimates = useQuery({
    queryKey: ['project-estimates', id],
    queryFn: () => estimatesApi.listForProject(id),
    enabled: Boolean(id),
  });
  const limits = usePlanLimits();

  const invalidateAfterRowAction = () => {
    qc.invalidateQueries({ queryKey: ['project-estimates', id] });
    qc.invalidateQueries({ queryKey: ['projects'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
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

  const createEstimate = useMutation({
    mutationFn: () => estimatesApi.createForProject(id, {}),
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: ['project-estimates', id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      navigate(routes.estimate(e.id));
    },
    onError: (err) => toast.error(toAppError(err).message),
  });

  // New estimate here is a choice: empty, or start from a template (defaults +
  // own). Applying a template reuses the backend apply-to-project endpoint.
  const applyTemplate = useApplyTemplate();
  const [estimateChoiceOpen, setEstimateChoiceOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  if (project.isPending) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center text-brand">
        <Spinner size="lg" />
      </div>
    );
  }
  if (project.isError || !project.data) {
    // Transient failure (offline / backend down / 5xx) is NOT "не знайдено" —
    // offer a retry instead of suggesting the project doesn't exist.
    const status = project.error ? toAppError(project.error).status : 404;
    if (project.isError && status !== 404 && status !== 403) {
      return <ErrorState error={project.error} onRetry={() => void project.refetch()} />;
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
    createEstimate.mutate();
  };
  const onPickTemplate = async (tpl: EstimateTemplateSummary) => {
    setTemplatePickerOpen(false);
    setEstimateChoiceOpen(false);
    try {
      const e = await applyTemplate.mutateAsync({ projectId: id, templateId: tpl.id, req: {} });
      qc.invalidateQueries({ queryKey: ['project-estimates', id] });
      navigate(routes.estimate(e.id));
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };
  // The project-level share CTA targets the NEWEST estimate — the same
  // "latest" notion the backend uses for the project card (latestEstimateTotal
  // / estimateStatus). Never blindly list[0]: the list order isn't guaranteed.
  const latestEstimate = [...list].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];

  const openShare = () => {
    if (list.length === 0) {
      toast.info(t('projects.createEstimateFirst'));
      return;
    }
    setShareOpen(true);
  };

  return (
    <>
      <EmailVerifyModal open={emailGateOpen} onClose={() => setEmailGateOpen(false)} />
      <ShareEstimateSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        estimateId={latestEstimate?.id ?? ''}
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

      {/* Estimate row quick-actions: reopen (SIGNED) or delete (DRAFT/SENT). */}
      <Modal
        open={menuFor !== null}
        onClose={() => setMenuFor(null)}
        title={menuFor ? estimateName(menuFor.name, menuFor.createdAt) : ''}
      >
        {menuFor && (
          <div className="space-y-2">
            {menuFor.status === 'SIGNED' ? (
              <button
                type="button"
                onClick={() => {
                  setConfirm({ kind: 'reopen', est: menuFor });
                  setMenuFor(null);
                }}
                className="w-full rounded-lg border border-border py-2.5 text-sm font-semibold text-primary"
              >
                {t('estimate.reopen')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setConfirm({ kind: 'delete', est: menuFor });
                  setMenuFor(null);
                }}
                className="w-full rounded-lg border border-danger/40 py-2.5 text-sm font-semibold text-danger"
              >
                {t('estimate.deleteEstimate')}
              </button>
            )}
          </div>
        )}
      </Modal>

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
      </Modal>

      <TemplatePickerSheet
        open={templatePickerOpen}
        onClose={() => setTemplatePickerOpen(false)}
        onPick={onPickTemplate}
        applying={applyTemplate.isPending}
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
            {t(tabItem.labelKey)}
          </button>
        ))}
      </div>

      {tab !== 'estimate' ? (
        <EmptyState icon="🚧" title={t('common.soon')} text={t('projects.sectionSoonText')} />
      ) : (
        <>
          <button
            type="button"
            onClick={openShare}
            className="mb-4 flex w-full items-center gap-3 rounded-card bg-brand p-3.5 text-left text-white shadow-cta"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-white/20 text-lg">
              📤
            </span>
            <span className="flex-1">
              <span className="block text-sm font-bold">{t('projects.shareWithClient')}</span>
              <span className="block text-[11px] opacity-85">{t('projects.clientPortalLink')}</span>
            </span>
            <span className="text-lg">→</span>
          </button>

          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-bold uppercase tracking-wide text-primary">
              {t('projects.estimatesCount', { count: list.length })}
            </h2>
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

          {atEstimateLimit && (
            <UpgradeBanner
              text={t('limits.estimatesHint', { max: limits.data?.maxEstimatesPerProject })}
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
                  onClick={() => navigate(routes.estimate(s.id))}
                  onMenu={() => setMenuFor(s)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <QuestionsSection projectId={id} />
    </>
  );
}

/** Loads the full estimate to show the backend-computed total + item count.
 *  A separate ⋮ button opens quick actions (delete / reopen) — kept outside the
 *  row's main button to avoid invalid nested buttons. */
function EstimateRow({
  summary,
  onClick,
  onMenu,
}: {
  summary: EstimateSummary;
  onClick: () => void;
  onMenu: () => void;
}) {
  const { t } = useTranslation();
  const full = useEstimate(summary.id);
  return (
    <div className="flex items-stretch rounded-card border border-border bg-surface">
      <button
        type="button"
        onClick={onClick}
        className="min-w-0 flex-1 px-3.5 py-3 text-left transition-transform active:scale-[0.99]"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-primary">
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
      <button
        type="button"
        onClick={onMenu}
        aria-label={t('estimate.actions')}
        className="flex w-11 flex-shrink-0 items-center justify-center text-xl leading-none text-muted"
      >
        ⋮
      </button>
    </div>
  );
}
