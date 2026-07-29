import type { QueryClient } from '@tanstack/react-query';
import { onlineManager } from '@tanstack/react-query';
import { planApi } from '@/api/plan.ts';
import { clientsApi } from '@/api/clients.ts';
import { catalogApi } from '@/api/catalog.ts';
import { estimateTemplatesApi } from '@/api/estimateTemplates.ts';
import { projectsApi } from '@/api/projects.ts';
import { estimatesApi } from '@/api/estimates.ts';
import { measurementsApi } from '@/api/measurements.ts';
import { notesApi } from '@/api/notes.ts';
import { dashboardApi } from '@/api/dashboard.ts';
import { messagesApi } from '@/api/messages.ts';
import { photosApi } from '@/api/photos.ts';
import { economyApi } from '@/api/economy.ts';
import { PLAN_LIMITS_KEY } from '@/features/plan/usePlanLimits.ts';
import { CLIENTS_KEY } from '@/features/clients/useClients.ts';
import { CATALOG_KEY } from '@/features/catalog/useCatalog.ts';
import { ESTIMATE_TEMPLATE_KEY } from '@/features/estimate/useEstimateTemplates.ts';
import { PROJECTS_KEY } from '@/features/projects/useProjects.ts';
import { ESTIMATE_KEY } from '@/features/estimate/useEstimate.ts';
import { MEASUREMENTS_KEY } from '@/features/measurements/useMeasurements.ts';
import { NOTES_KEY } from '@/features/notes/useNotes.ts';
import { messagesKey } from '@/features/messages/useMessages.ts';
import { PHOTOS_KEY } from '@/features/photos/usePhotos.ts';
import { economyKeys } from '@/features/economy/useEconomy.ts';
import type { ProjectResponse } from '@/api/types.ts';

/**
 * Warm the offline cache with EVERYTHING the master might open on site ("download it all ahead").
 *
 * The persisted query cache only holds what was actually fetched, so a screen never opened while
 * online is blank in a basement. This walks the master's real data — objects → their estimates →
 * each estimate's items, plus measurements, notes, clients, catalog and templates — and primes the
 * exact same query keys the hooks use, so the pages find their data already there.
 *
 * Deliberately: `prefetchQuery` (never throws — one failed sub-request can't abort the run), a
 * small concurrency cap (a phone on mobile data, not a crawler), and PRO-only data skipped for
 * FREE (it would just 403).
 */
export interface PrefetchProgress {
  done: number;
  total: number;
}

const CONCURRENCY = 4;
/** Don't re-walk everything on every launch — an automatic run is throttled to this. */
const AUTO_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const LAST_RUN_KEY = 'majstr-prefetch-at';

export function lastPrefetchAt(): number {
  const raw = localStorage.getItem(LAST_RUN_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Fresh-enough that an automatic run would be pointless. */
export function prefetchIsFresh(now = Date.now()): boolean {
  return now - lastPrefetchAt() < AUTO_INTERVAL_MS;
}

export async function prefetchForOffline(
  qc: QueryClient,
  opts: { isPro?: boolean; onProgress?: (p: PrefetchProgress) => void } = {},
): Promise<{ objects: number; estimates: number }> {
  if (!onlineManager.isOnline()) return { objects: 0, estimates: 0 };

  let done = 0;
  let total = 0;
  const report = () => opts.onProgress?.({ done, total });

  const run = async (task: () => Promise<unknown>) => {
    try {
      await task();
    } finally {
      done += 1;
      report();
    }
  };

  /** Run tasks with a small concurrency cap. */
  const pool = async (tasks: (() => Promise<unknown>)[]) => {
    let i = 0;
    const worker = async () => {
      while (i < tasks.length) {
        const task = tasks[i++];
        await run(task);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));
  };

  // ---- core: everything not tied to one object -----------------------------
  const core: (() => Promise<unknown>)[] = [
    () => qc.prefetchQuery({ queryKey: PLAN_LIMITS_KEY, queryFn: () => planApi.limits() }),
    () => qc.prefetchQuery({ queryKey: [...CLIENTS_KEY, 'list'], queryFn: () => clientsApi.list() }),
    () => qc.prefetchQuery({ queryKey: [...CATALOG_KEY, 'list', 'all'], queryFn: () => catalogApi.list(undefined) }),
    () => qc.prefetchQuery({ queryKey: [...CATALOG_KEY, 'categories'], queryFn: () => catalogApi.categories() }),
    () => qc.prefetchQuery({ queryKey: ESTIMATE_TEMPLATE_KEY, queryFn: () => estimateTemplatesApi.list() }),
    () => qc.prefetchQuery({ queryKey: ['dashboard', 'metrics'], queryFn: () => dashboardApi.metrics() }),
  ];
  total = core.length + 1; // + the projects list below
  report();
  await pool(core);

  // ---- the objects, then everything inside each ----------------------------
  await run(() =>
    qc.prefetchQuery({
      queryKey: [...PROJECTS_KEY, 'list', 'all'],
      queryFn: () => projectsApi.list(undefined),
    }),
  );
  const projects = qc.getQueryData<ProjectResponse[]>([...PROJECTS_KEY, 'list', 'all']) ?? [];

  const perProject: (() => Promise<unknown>)[] = [];
  for (const p of projects) {
    perProject.push(() =>
      qc.prefetchQuery({ queryKey: [...PROJECTS_KEY, 'detail', p.id], queryFn: () => projectsApi.get(p.id) }));
    perProject.push(() =>
      qc.prefetchQuery({ queryKey: ['project-estimates', p.id], queryFn: () => estimatesApi.listForProject(p.id) }));
    perProject.push(() =>
      qc.prefetchQuery({ queryKey: NOTES_KEY(p.id), queryFn: () => notesApi.list(p.id) }));
    // The object's other tabs, so none of them is blank on site.
    perProject.push(() =>
      qc.prefetchQuery({ queryKey: messagesKey(p.id), queryFn: () => messagesApi.listForProject(p.id) }));
    perProject.push(() =>
      qc.prefetchQuery({ queryKey: PHOTOS_KEY(p.id), queryFn: () => photosApi.list(p.id) }));
    if (opts.isPro) {
      // Measurements + economy are PRO-gated — prefetching them on FREE would just 403.
      perProject.push(() =>
        qc.prefetchQuery({ queryKey: MEASUREMENTS_KEY(p.id), queryFn: () => measurementsApi.tree(p.id) }));
      perProject.push(() =>
        qc.prefetchQuery({ queryKey: economyKeys.economy(p.id), queryFn: () => economyApi.economy(p.id) }));
      perProject.push(() =>
        qc.prefetchQuery({ queryKey: economyKeys.expenses(p.id), queryFn: () => economyApi.listExpenses(p.id) }));
    }
  }
  total += perProject.length;
  report();
  await pool(perProject);

  // ---- each TEMPLATE's composition -----------------------------------------
  // Without this the list is cached but tapping a template offline shows nothing — which the UI
  // used to render as "this template has no positions" (a lie about the master's own data).
  const templates = qc.getQueryData<{ id: string }[]>(ESTIMATE_TEMPLATE_KEY) ?? [];
  const perTemplate = templates.map((tpl) => () =>
    qc.prefetchQuery({
      queryKey: [...ESTIMATE_TEMPLATE_KEY, tpl.id],
      queryFn: () => estimateTemplatesApi.get(tpl.id),
    }));
  total += perTemplate.length;
  report();
  await pool(perTemplate);

  // ---- each estimate's full detail (the items the master edits on site) ----
  const estimateIds = projects.flatMap((p) =>
    (qc.getQueryData<{ id: string }[]>(['project-estimates', p.id]) ?? []).map((e) => e.id));
  const perEstimate = estimateIds.map((id) => () =>
    qc.prefetchQuery({ queryKey: [...ESTIMATE_KEY, id], queryFn: () => estimatesApi.get(id) }));
  total += perEstimate.length;
  report();
  await pool(perEstimate);

  // Re-stamp the core lists so they are the FRESHEST entries in the cache. The persister retries
  // a quota failure with `removeOldestQuery`, which evicts by `dataUpdatedAt` — and the core is
  // fetched first here, so it was precisely what got thrown away on a big account. That is how a
  // master ended up with every object available offline but an empty catalog, no templates and no
  // clients to attach. Touching the data (same value, new timestamp) puts them last in line.
  for (const key of [
    PLAN_LIMITS_KEY,
    [...CLIENTS_KEY, 'list'],
    [...CATALOG_KEY, 'list', 'all'],
    [...CATALOG_KEY, 'categories'],
    ESTIMATE_TEMPLATE_KEY,
  ] as const) {
    const cached = qc.getQueryData(key);
    if (cached !== undefined) qc.setQueryData(key, cached);
  }

  localStorage.setItem(LAST_RUN_KEY, String(Date.now()));
  return { objects: projects.length, estimates: estimateIds.length };
}
