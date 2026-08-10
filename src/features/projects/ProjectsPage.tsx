import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Chip } from '@/components/Chip.tsx';
import { InfoPopover } from '@/components/InfoPopover.tsx';
import { Button } from '@/components/Button.tsx';
import { Skeleton } from '@/components/Skeleton.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { ProjectCard } from '@/components/ProjectCard.tsx';
import { UpgradeBanner } from '@/components/UpgradeBanner.tsx';
import { routes } from '@/lib/config.ts';
import type { ObjectStage, ProjectResponse } from '@/api/types.ts';
import { useProjects } from './useProjects.ts';
import { usePlanLimits, isAtLimit } from '@/features/plan/usePlanLimits.ts';

/**
 * Filter is URL-driven (`?stage=`) so the dashboard metric cards can deep-link straight into a
 * filtered list — one vocabulary, the derived {@link ObjectStage} (object-status-unification), not
 * a mix of the project's own status and the latest estimate's. CANCELLED has no dedicated chip
 * (a master rarely wants to filter TO it), but "Усі" still counts/shows cancelled objects — hiding
 * them from the list entirely would make a mis-click unrecoverable from the UI.
 */
type Filter = 'ALL' | Exclude<ObjectStage, 'CANCELLED'>;

const FILTERS: { value: Filter; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'projects.filterAll' },
  { value: 'ASSESSMENT', labelKey: 'projects.filterAssessment' },
  { value: 'PENDING_SIGNATURE', labelKey: 'projects.filterPending' },
  { value: 'IN_PROGRESS', labelKey: 'projects.filterInProgress' },
  { value: 'COMPLETED', labelKey: 'projects.filterCompleted' },
];

/** Exported for a standalone test (object-status-unification) — this one function is the whole
 *  fix for the "1 vs 0" bug report: everything now reads the SAME derived `stage`, never a mix of
 *  the object's own status and the latest estimate's. */
export function matches(p: ProjectResponse, f: Filter): boolean {
  return f === 'ALL' || p.stage === f;
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get('stage');
  const filter: Filter =
    raw === 'ASSESSMENT' || raw === 'PENDING_SIGNATURE' || raw === 'IN_PROGRESS' || raw === 'COMPLETED'
      ? raw : 'ALL';

  // Fetch all once and filter client-side so the chips can show live counts.
  const { data, isPending, isError, refetch } = useProjects();
  const all = useMemo(() => data ?? [], [data]);

  // FREE caps the number of objects. Block "new object" preemptively (the
  // backend still enforces it) once the count reaches the cap.
  const limits = usePlanLimits();
  const atProjectLimit = isAtLimit(all.length, limits.data?.maxProjects);

  const counts = useMemo<Record<Filter, number>>(
    () => ({
      ALL: all.length,
      ASSESSMENT: all.filter((p) => p.stage === 'ASSESSMENT').length,
      PENDING_SIGNATURE: all.filter((p) => p.stage === 'PENDING_SIGNATURE').length,
      IN_PROGRESS: all.filter((p) => p.stage === 'IN_PROGRESS').length,
      COMPLETED: all.filter((p) => p.stage === 'COMPLETED').length,
    }),
    [all],
  );
  const shown = useMemo(() => all.filter((p) => matches(p, filter)), [all, filter]);

  const setFilter = (f: Filter) =>
    setParams(f === 'ALL' ? {} : { stage: f }, { replace: true });
  // Combined flow (object + first estimate) vs. object-only. Both consume the
  // FREE object quota, so both are gated the same way.
  const newCombined = () => {
    if (atProjectLimit) return; // prevention; disabled buttons shouldn't fire anyway
    void navigate(routes.newEstimate);
  };
  const newObject = () => {
    if (atProjectLimit) return;
    void navigate(routes.newObject);
  };
  const limitTooltip = atProjectLimit ? t('limits.atLimitTooltip') : undefined;

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-primary sm:text-[26px]">
          {t('projects.title')}
        </h1>
        <div className="hidden gap-2 sm:flex">
          <Button
            variant="secondary"
            onClick={newObject}
            disabled={atProjectLimit}
            title={limitTooltip}
          >
            {t('common.newObject')}
          </Button>
          <Button onClick={newCombined} disabled={atProjectLimit} title={limitTooltip}>
            {t('common.addEstimate')}
          </Button>
        </div>
      </div>

      {atProjectLimit && (
        <UpgradeBanner text={t('limits.objectsHint', { max: limits.data?.maxProjects })} trigger="OBJECT_LIMIT" />
      )}

      <div className="mb-4 flex items-center gap-2">
        <div className="flex flex-1 gap-2 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <Chip key={f.value} active={filter === f.value} onClick={() => setFilter(f.value)}>
              {t(f.labelKey)} · {counts[f.value]}
            </Chip>
          ))}
        </div>
        <InfoPopover text={t('projects.stageLegend')} label={t('projects.stageLegendLabel')} />
      </div>

      {isPending ? (
        <div className="space-y-2.5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[68px] rounded-card" />
          ))}
        </div>
      ) : isError && !data ? (
        // Only when there's nothing cached — offline (or a backend blip) must still show the
        // master's own objects from the offline cache, not an error screen.
        <EmptyState
          icon="⚠️"
          title={t('projects.loadErrorTitle')}
          text={t('projects.loadErrorText')}
          action={<Button onClick={() => void refetch()}>{t('common.retry')}</Button>}
        />
      ) : all.length === 0 ? (
        <EmptyState
          icon="📁"
          title={t('projects.emptyTitle')}
          text={t('projects.emptyText')}
          action={
            <div className="flex flex-col items-center gap-2">
              <Button onClick={newCombined}>{t('common.addEstimate')}</Button>
              <Button variant="secondary" onClick={newObject}>
                {t('common.newObject')}
              </Button>
            </div>
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState
          icon="🔍"
          title={t('projects.noneFoundTitle')}
          text={t('projects.noneFoundText')}
        />
      ) : (
        <>
          <div className="space-y-2.5">
            {shown.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
          <div className="mt-5 flex flex-col gap-2 sm:hidden">
            <Button
              onClick={newCombined}
              disabled={atProjectLimit}
              title={limitTooltip}
              fullWidth
              className="py-3.5 shadow-cta"
            >
              {t('common.addEstimate')}
            </Button>
            <Button
              variant="secondary"
              onClick={newObject}
              disabled={atProjectLimit}
              title={limitTooltip}
              fullWidth
              className="py-3.5"
            >
              {t('common.newObject')}
            </Button>
          </div>
        </>
      )}
    </>
  );
}
