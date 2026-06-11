import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/Badge.tsx';
import { Button } from '@/components/Button.tsx';
import { Modal } from '@/components/Modal.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { ErrorState } from '@/components/ErrorState.tsx';
import { estimatesApi } from '@/api/estimates.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { formatMoney, formatNumber, initials } from '@/lib/format.ts';
import { ESTIMATE_STATUS_VARIANT } from '@/lib/labels.ts';
import i18n from '@/lib/i18n.ts';
import { routes } from '@/lib/config.ts';
import type { EstimateItemResponse, EstimateResponse, ProjectResponse } from '@/api/types.ts';
import { useProject } from '@/features/projects/useProjects.ts';
import { EmailVerifyModal } from '@/features/email/EmailVerifyModal.tsx';
import { ItemForm } from './ItemForm.tsx';
import { AddItemSheet } from './AddItemSheet.tsx';
import { ShareEstimateSheet } from './ShareEstimateSheet.tsx';
import { useEstimate, useRemoveItem, useUpdateItem } from './useEstimate.ts';

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

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<EstimateItemResponse | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [emailGateOpen, setEmailGateOpen] = useState(false);

  if (estimate.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas text-brand">
        <Spinner size="lg" />
      </div>
    );
  }

  if (estimate.isError || !estimate.data) {
    // Transient failure (offline / backend down / 5xx) is NOT "не знайдено" —
    // offer a retry instead of suggesting the estimate doesn't exist.
    const status = estimate.error ? toAppError(estimate.error).status : 404;
    if (estimate.isError && status !== 404 && status !== 403) {
      return (
        <div className="flex min-h-dvh items-center justify-center bg-canvas">
          <ErrorState error={estimate.error} onRetry={() => void estimate.refetch()} />
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

  const goBack = () => navigate(projectId ? routes.project(projectId) : routes.projects);

  const onPdf = async () => {
    setPdfLoading(true);
    try {
      const { url, revoke } = await estimatesApi.fetchPdf(id);
      window.open(url, '_blank');
      setTimeout(revoke, 60_000);
    } catch {
      toast.error(t('estimate.pdfFailed'));
    } finally {
      setPdfLoading(false);
    }
  };

  const onShare = () => setShareOpen(true);

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
              {t('estimate.title')}{project.data ? ` · ${project.data.name}` : ''}
            </div>
            <div className="text-xs text-muted">{t('estimate.autosaved')}</div>
          </div>
          <Badge variant={ESTIMATE_STATUS_VARIANT[est.status]}>
            {t('status.estimate.' + est.status)}
          </Badge>
        </div>

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
                action={<Button onClick={() => setAddOpen(true)}>{t('estimate.addItem')}</Button>}
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
                          onClick={() => setEditing(item)}
                          className="w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-left transition-transform active:scale-[0.99]"
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

                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-brand py-3 text-sm font-semibold text-brand"
                >
                  {t('estimate.addItem')}
                </button>
              </>
            )}
          </div>

          {/* Desktop summary */}
          <div className="hidden lg:sticky lg:top-8 lg:block">
            <SummaryCard
              est={est}
              project={project.data}
              onPdf={onPdf}
              onShare={onShare}
              pdfLoading={pdfLoading}
            />
          </div>
        </div>
      </div>

      {/* Mobile sticky total bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 bg-ink px-5 pb-7 pt-3.5 text-white lg:hidden">
        <div className="mb-2.5 flex items-end justify-between">
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
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onPdf}
            disabled={pdfLoading}
            className="rounded-[10px] bg-white/[0.12] py-3 text-sm font-semibold disabled:opacity-60"
          >
            {t('estimate.pdf')}
          </button>
          <button
            type="button"
            onClick={onShare}
            className="rounded-[10px] bg-brand py-3 text-sm font-semibold"
          >
            {t('estimate.share')}
          </button>
        </div>
      </div>

      <EmailVerifyModal open={emailGateOpen} onClose={() => setEmailGateOpen(false)} />
      {project.data && (
        <ShareEstimateSheet
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          estimateId={id}
          project={project.data}
          onNeedEmailVerify={() => setEmailGateOpen(true)}
        />
      )}

      <AddItemSheet
        estimateId={id}
        nextSortOrder={nextSortOrder}
        open={addOpen}
        onClose={() => setAddOpen(false)}
      />

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={t('estimate.editItem')}>
        {editing && (
          <ItemForm
            key={editing.id}
            initial={editing}
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
            onDelete={async () => {
              try {
                await removeItem.mutateAsync(editing.id);
                toast.success(t('estimate.deleted'));
                setEditing(null);
              } catch (err) {
                toast.error(toAppError(err).message);
              }
            }}
          />
        )}
      </Modal>
    </div>
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
  onPdf,
  onShare,
  pdfLoading,
}: {
  est: EstimateResponse;
  project: ProjectResponse | undefined;
  onPdf: () => void;
  onShare: () => void;
  pdfLoading: boolean;
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
      <div
        data-testid="estimate-total"
        className="my-1.5 text-2xl font-extrabold tracking-tight"
      >
        {formatMoney(est.total)}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <Button onClick={onShare} fullWidth>
          {t('estimate.shareWithClientBtn')}
        </Button>
        <button
          type="button"
          onClick={onPdf}
          disabled={pdfLoading}
          className="rounded-[10px] bg-white/[0.12] py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {t('estimate.generatePdf')}
        </button>
      </div>
    </div>
  );
}
