import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Chip } from '@/components/Chip.tsx';
import { InfoPopover } from '@/components/InfoPopover.tsx';
import { Button } from '@/components/Button.tsx';
import { Fab, FabAction } from '@/components/Fab.tsx';
import { Skeleton } from '@/components/Skeleton.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { ProjectCard } from '@/components/ProjectCard.tsx';
import { UpgradeBanner } from '@/components/UpgradeBanner.tsx';
import { routes } from '@/lib/config.ts';
import type { ObjectStage, ProjectResponse } from '@/api/types.ts';
import { useProjects, isTerminalStage } from './useProjects.ts';
import { usePlanLimits, isAtLimit } from '@/features/plan/usePlanLimits.ts';

/**
 * Filter is URL-driven (`?stage=`) so the dashboard metric cards can deep-link straight into a
 * filtered list — one vocabulary, the derived {@link ObjectStage} (object-status-unification), not
 * a mix of the project's own status and the latest estimate's.
 *
 * <p>Terminal objects (COMPLETED/CANCELLED — {@link isTerminalStage}) are HIDDEN by default: a
 * finished or cancelled object is clutter on the day-to-day list. The FAB toggles them back in
 * (`showArchived`), which also surfaces their two dedicated chips. When hidden, "Усі" counts and
 * shows only live objects.</p>
 */
type Filter = 'ALL' | ObjectStage;

const SHOW_ARCHIVED_KEY = 'majstr-projects-show-archived';

const BASE_FILTERS: { value: Filter; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'projects.filterAll' },
  { value: 'ASSESSMENT', labelKey: 'projects.filterAssessment' },
  { value: 'PENDING_SIGNATURE', labelKey: 'projects.filterPending' },
  { value: 'IN_PROGRESS', labelKey: 'projects.filterInProgress' },
];

/** The archived chips appear only once the master opts to show archived objects. */
const ARCHIVED_FILTERS: { value: Filter; labelKey: string }[] = [
  { value: 'COMPLETED', labelKey: 'projects.filterCompleted' },
  { value: 'CANCELLED', labelKey: 'projects.filterCancelled' },
];

/** Exported for a standalone test (object-status-unification) — this one function is the whole
 *  fix for the "1 vs 0" bug report: everything reads the SAME derived `stage`. `showArchived` gates
 *  terminal objects out of the "Усі" list until the master reveals them via the FAB. */
export function matches(p: ProjectResponse, f: Filter, showArchived: boolean): boolean {
  if (f === 'ALL') return showArchived || !isTerminalStage(p.stage);
  return p.stage === f;
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get('stage');
  const filter: Filter =
    raw === 'ASSESSMENT' || raw === 'PENDING_SIGNATURE' || raw === 'IN_PROGRESS'
    || raw === 'COMPLETED' || raw === 'CANCELLED'
      ? raw : 'ALL';

  // Terminal (completed/cancelled) objects are hidden by default; the FAB reveals them. Persisted so
  // the choice survives navigation. A deep-link straight to a terminal chip (?stage=COMPLETED, e.g.
  // from the dashboard's «Завершено» card) implies wanting to see them, so it forces the reveal on.
  const [showArchived, setShowArchived] = useState<boolean>(() => {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(SHOW_ARCHIVED_KEY) === '1') return true;
    return raw === 'COMPLETED' || raw === 'CANCELLED';
  });
  const toggleArchived = () => {
    // Side effects OUTSIDE the state updater — React may invoke an updater twice (StrictMode), and
    // localStorage/setParams must run exactly once per tap.
    const next = !showArchived;
    if (typeof localStorage !== 'undefined') localStorage.setItem(SHOW_ARCHIVED_KEY, next ? '1' : '0');
    // Leaving archived hidden while parked on a terminal chip would show an empty list — bounce to «Усі».
    if (!next && (filter === 'COMPLETED' || filter === 'CANCELLED')) setParams({}, { replace: true });
    setShowArchived(next);
  };

  // Fetch all once and filter client-side so the chips can show live counts.
  const { data, isPending, isError, refetch } = useProjects();
  const all = useMemo(() => data ?? [], [data]);
  const hasArchived = useMemo(() => all.some((p) => isTerminalStage(p.stage)), [all]);
  // The reveal is a sticky PREFERENCE, but it describes DATA that can vanish underneath it: delete
  // the last COMPLETED/CANCELLED object and there is nothing left to reveal or hide. Everything the
  // reveal drives reads this derived value instead, so the FAB and the two archived chips can't
  // outlive the objects they belong to. `showArchived` itself is left alone — the preference still
  // applies the moment a new object is closed out.
  const archivedVisible = showArchived && hasArchived;
  const filters = archivedVisible ? [...BASE_FILTERS, ...ARCHIVED_FILTERS] : BASE_FILTERS;

  // FREE caps the number of objects EVER created (lifetime `projectsUsed`, not the live count) so a
  // delete can't slip past it — the backend enforces the same. Block "new object" preemptively.
  const limits = usePlanLimits();
  const atProjectLimit = isAtLimit(limits.data?.projectsUsed ?? 0, limits.data?.maxProjects);

  const counts = useMemo<Record<Filter, number>>(
    () => ({
      // «Усі» counts what «Усі» shows: live-only unless archived is revealed.
      ALL: archivedVisible ? all.length : all.filter((p) => !isTerminalStage(p.stage)).length,
      ASSESSMENT: all.filter((p) => p.stage === 'ASSESSMENT').length,
      PENDING_SIGNATURE: all.filter((p) => p.stage === 'PENDING_SIGNATURE').length,
      IN_PROGRESS: all.filter((p) => p.stage === 'IN_PROGRESS').length,
      COMPLETED: all.filter((p) => p.stage === 'COMPLETED').length,
      CANCELLED: all.filter((p) => p.stage === 'CANCELLED').length,
    }),
    [all, archivedVisible],
  );
  const shown = useMemo(
    () => all.filter((p) => matches(p, filter, archivedVisible)),
    [all, filter, archivedVisible],
  );

  // The same bounce `toggleArchived` does on a tap, triggered by the DATA instead: deleting the last
  // archived object while parked on its chip would strand the master on a list that can never fill
  // again (the chip is gone with it). Guarded on `data` — before the first load `all` is empty and
  // every deep-link into ?stage=COMPLETED would bounce itself before its objects ever arrived.
  useEffect(() => {
    if (data && !hasArchived && (filter === 'COMPLETED' || filter === 'CANCELLED')) {
      setParams({}, { replace: true });
    }
  }, [data, hasArchived, filter, setParams]);

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
        <UpgradeBanner text={t('limits.objectsHint', { max: limits.data?.maxProjects, used: limits.data?.projectsUsed })} trigger="OBJECT_LIMIT" />
      )}

      <div className="mb-4 flex items-center gap-2">
        <div className="flex flex-1 gap-2 overflow-x-auto pb-1">
          {filters.map((f) => (
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

      {/* View settings live behind the FAB so the toolbar stays clean. Shown only when archived
          objects actually exist — `hasArchived` counts the FULL list, so it is already true while
          they are revealed. (It used to be `hasArchived || showArchived`, and that second branch was
          reachable ONLY with zero archived objects: after deleting the last one the FAB stayed on
          screen offering to hide what was no longer there.) */}
      {hasArchived && (
        <Fab ariaLabel={t('projects.viewSettings')}>
          {(close) => (
            <FabAction
              icon={showArchived ? '🙈' : '🗄'}
              label={showArchived ? t('projects.hideArchived') : t('projects.showArchived')}
              onClick={() => close(toggleArchived)}
            />
          )}
        </Fab>
      )}
    </>
  );
}
