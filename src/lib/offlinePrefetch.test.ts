import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { prefetchForOffline } from './offlinePrefetch.ts';
import { projectsApi } from '@/api/projects.ts';
import { estimatesApi } from '@/api/estimates.ts';
import { measurementsApi } from '@/api/measurements.ts';
import { clientsApi } from '@/api/clients.ts';
import { catalogApi } from '@/api/catalog.ts';
import { estimateTemplatesApi } from '@/api/estimateTemplates.ts';
import { notesApi } from '@/api/notes.ts';
import { planApi } from '@/api/plan.ts';
import { dashboardApi } from '@/api/dashboard.ts';
import { messagesApi } from '@/api/messages.ts';
import { photosApi } from '@/api/photos.ts';
import { economyApi } from '@/api/economy.ts';
import { ESTIMATE_TEMPLATE_KEY } from '@/features/estimate/useEstimateTemplates.ts';
import { PROJECTS_KEY } from '@/features/projects/useProjects.ts';
import { ESTIMATE_KEY } from '@/features/estimate/useEstimate.ts';
import { MEASUREMENTS_KEY } from '@/features/measurements/useMeasurements.ts';
import { CLIENTS_KEY } from '@/features/clients/useClients.ts';
import { CATALOG_KEY } from '@/features/catalog/useCatalog.ts';

vi.mock('@/api/projects.ts', () => ({ projectsApi: { list: vi.fn(), get: vi.fn() } }));
vi.mock('@/api/estimates.ts', () => ({ estimatesApi: { listForProject: vi.fn(), get: vi.fn() } }));
vi.mock('@/api/measurements.ts', () => ({ measurementsApi: { tree: vi.fn() } }));
vi.mock('@/api/clients.ts', () => ({ clientsApi: { list: vi.fn() } }));
vi.mock('@/api/catalog.ts', () => ({ catalogApi: { list: vi.fn(), categories: vi.fn() } }));
vi.mock('@/api/estimateTemplates.ts', () => ({
  estimateTemplatesApi: { list: vi.fn(), get: vi.fn() },
}));
vi.mock('@/api/notes.ts', () => ({ notesApi: { list: vi.fn() } }));
vi.mock('@/api/plan.ts', () => ({ planApi: { limits: vi.fn() } }));
vi.mock('@/api/dashboard.ts', () => ({ dashboardApi: { metrics: vi.fn() } }));
vi.mock('@/api/messages.ts', () => ({ messagesApi: { listForProject: vi.fn() } }));
vi.mock('@/api/photos.ts', () => ({ photosApi: { list: vi.fn() } }));
vi.mock('@/api/economy.ts', () => ({ economyApi: { economy: vi.fn(), listExpenses: vi.fn() } }));

const project = { id: 'p1', name: 'Хата' };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(planApi.limits).mockResolvedValue({} as never);
  vi.mocked(clientsApi.list).mockResolvedValue([{ id: 'c1' }] as never);
  vi.mocked(catalogApi.list).mockResolvedValue([{ id: 'k1' }] as never);
  vi.mocked(catalogApi.categories).mockResolvedValue(['Стіни'] as never);
  vi.mocked(estimateTemplatesApi.list).mockResolvedValue([{ id: 't1' }] as never);
  vi.mocked(estimateTemplatesApi.get).mockResolvedValue({ id: 't1', items: [{ name: 'Поз.' }] } as never);
  vi.mocked(messagesApi.listForProject).mockResolvedValue([] as never);
  vi.mocked(photosApi.list).mockResolvedValue([] as never);
  vi.mocked(economyApi.economy).mockResolvedValue({} as never);
  vi.mocked(economyApi.listExpenses).mockResolvedValue([] as never);
  vi.mocked(dashboardApi.metrics).mockResolvedValue({} as never);
  vi.mocked(projectsApi.list).mockResolvedValue([project] as never);
  vi.mocked(projectsApi.get).mockResolvedValue(project as never);
  vi.mocked(estimatesApi.listForProject).mockResolvedValue([{ id: 'e1' }] as never);
  vi.mocked(estimatesApi.get).mockResolvedValue({ id: 'e1', items: [] } as never);
  vi.mocked(measurementsApi.tree).mockResolvedValue({ rooms: [] } as never);
  vi.mocked(notesApi.list).mockResolvedValue([] as never);
});

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('prefetchForOffline', () => {
  it('walks objects → estimates → items and fills the SAME keys the hooks read', async () => {
    const qc = client();

    const result = await prefetchForOffline(qc, { isPro: true });

    expect(result).toEqual({ objects: 1, estimates: 1 });
    // Exactly the keys the pages query — a mismatch here would silently leave screens blank.
    expect(qc.getQueryData([...PROJECTS_KEY, 'list', 'all'])).toBeTruthy();
    expect(qc.getQueryData([...PROJECTS_KEY, 'detail', 'p1'])).toBeTruthy();
    expect(qc.getQueryData(['project-estimates', 'p1'])).toBeTruthy();
    expect(qc.getQueryData([...ESTIMATE_KEY, 'e1'])).toBeTruthy();
    expect(qc.getQueryData(MEASUREMENTS_KEY('p1'))).toBeTruthy();
    expect(qc.getQueryData([...CLIENTS_KEY, 'list'])).toBeTruthy();
    expect(qc.getQueryData([...CATALOG_KEY, 'list', 'all'])).toBeTruthy();
    expect(qc.getQueryData([...CATALOG_KEY, 'categories'])).toBeTruthy();
  });

  it('caches each TEMPLATE composition (else offline it looked like "no positions")', async () => {
    const qc = client();

    await prefetchForOffline(qc, { isPro: true });

    // Prod report: the list was cached but the composition was not, so tapping a template offline
    // rendered an empty list — which the UI read as "this template has no positions".
    expect(qc.getQueryData([...ESTIMATE_TEMPLATE_KEY, 't1'])).toBeTruthy();
  });

  it('skips PRO-only measurements and economy on FREE (would just 403)', async () => {
    const qc = client();
    await prefetchForOffline(qc, { isPro: false });
    expect(measurementsApi.tree).not.toHaveBeenCalled();
    expect(economyApi.economy).not.toHaveBeenCalled();
  });

  it('keeps going when one request fails (best-effort warming)', async () => {
    vi.mocked(estimatesApi.get).mockRejectedValue(new Error('boom'));
    const qc = client();

    const result = await prefetchForOffline(qc, { isPro: true });

    expect(result.objects).toBe(1);
    expect(qc.getQueryData([...PROJECTS_KEY, 'detail', 'p1'])).toBeTruthy(); // the rest still landed
  });

  it('reports progress', async () => {
    const seen: number[] = [];
    await prefetchForOffline(client(), { isPro: true, onProgress: (p) => seen.push(p.done) });
    expect(seen.length).toBeGreaterThan(0);
    expect(Math.max(...seen)).toBeGreaterThan(1);
  });
});
