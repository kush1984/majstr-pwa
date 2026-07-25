import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Chip } from '@/components/Chip.tsx';
import { Button } from '@/components/Button.tsx';
import { Skeleton } from '@/components/Skeleton.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { ProjectCard } from '@/components/ProjectCard.tsx';
import { UpgradeBanner } from '@/components/UpgradeBanner.tsx';
import { routes } from '@/lib/config.ts';
import type { ProjectResponse } from '@/api/types.ts';
import { useProjects } from './useProjects.ts';
import { usePlanLimits, isAtLimit } from '@/features/plan/usePlanLimits.ts';

/**
 * Filter is URL-driven (`?status=`) so the dashboard metric cards can deep-link
 * straight into a filtered list. SENT filters by the latest estimate's status
 * (awaiting signature); the others by the project's own status.
 */
type Filter = 'ALL' | 'IN_PROGRESS' | 'SENT' | 'COMPLETED';

const FILTERS: { value: Filter; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'projects.filterAll' },
  { value: 'IN_PROGRESS', labelKey: 'projects.filterInProgress' },
  { value: 'SENT', labelKey: 'projects.filterPending' },
  { value: 'COMPLETED', labelKey: 'projects.filterCompleted' },
];

function matches(p: ProjectResponse, f: Filter): boolean {
  if (f === 'ALL') return true;
  if (f === 'SENT') return p.estimateStatus === 'SENT';
  return p.status === f;
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get('status');
  const filter: Filter =
    raw === 'IN_PROGRESS' || raw === 'SENT' || raw === 'COMPLETED' ? raw : 'ALL';

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
      IN_PROGRESS: all.filter((p) => p.status === 'IN_PROGRESS').length,
      SENT: all.filter((p) => p.estimateStatus === 'SENT').length,
      COMPLETED: all.filter((p) => p.status === 'COMPLETED').length,
    }),
    [all],
  );
  const shown = useMemo(() => all.filter((p) => matches(p, filter)), [all, filter]);

  const setFilter = (f: Filter) =>
    setParams(f === 'ALL' ? {} : { status: f }, { replace: true });
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

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <Chip key={f.value} active={filter === f.value} onClick={() => setFilter(f.value)}>
            {t(f.labelKey)} · {counts[f.value]}
          </Chip>
        ))}
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
