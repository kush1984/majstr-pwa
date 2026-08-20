import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ProjectsPage } from './ProjectsPage.tsx';
import { PROJECTS_KEY } from './useProjects.ts';
import { projectsApi } from '@/api/projects.ts';
import type { ObjectStage, ProjectResponse } from '@/api/types.ts';

/**
 * The archived reveal (FAB + the two terminal chips) describes DATA, not just a preference — and the
 * data can disappear underneath it, because a permanent delete is offered ONLY on a terminal object.
 * Delete the last COMPLETED/CANCELLED one and the reveal has nothing left to reveal: the FAB used to
 * stay on screen offering to hide what was already gone, and a master parked on «Завершені» was left
 * on a list that could never fill again.
 */
vi.mock('@/api/projects.ts', () => ({
  projectsApi: { list: vi.fn() },
}));
vi.mock('@/api/plan.ts', () => ({
  planApi: { limits: vi.fn().mockResolvedValue({ projectsUsed: 1, maxProjects: null }) },
}));

function project(id: string, stage: ObjectStage): ProjectResponse {
  return {
    id, name: `Обʼєкт ${id}`, address: 'вул. 1', status: 'IN_PROGRESS', stage,
    description: null, clientId: null, clientFullName: null,
    latestEstimateTotal: null, estimateStatus: null, unreadQuestions: 0,
    completedAt: null, createdAt: '2026-08-01T10:00:00Z', updatedAt: '2026-08-01T10:00:00Z',
  } as unknown as ProjectResponse;
}

const LIVE = project('p1', 'IN_PROGRESS');
const DONE = project('p2', 'COMPLETED');

let location = '';
function LocationSpy() {
  const l = useLocation();
  location = `${l.pathname}${l.search}`;
  return null;
}

function renderPage(list: ProjectResponse[], route = '/projects') {
  vi.mocked(projectsApi.list).mockResolvedValue(list);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <LocationSpy />
        <ProjectsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  /**
   * Exactly what deleting an object does: the server now returns the shorter list, and
   * `useDeleteProject`'s `onOnlineSuccess` invalidates the projects key so it is refetched. (Writing
   * the cache directly would be a weaker test — the query is stale, so the very next refetch would
   * put the deleted object straight back.)
   */
  const setList = async (next: ProjectResponse[]) => {
    vi.mocked(projectsApi.list).mockResolvedValue(next);
    await act(async () => {
      await qc.invalidateQueries({ queryKey: PROJECTS_KEY });
    });
  };
  return { ...view, setList };
}

const fab = () => screen.queryByRole('button', { name: 'Налаштування списку' });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  location = '';
});

describe('ProjectsPage — the archived reveal follows the data', () => {
  it('offers the FAB while a terminal object exists', async () => {
    renderPage([LIVE, DONE]);
    await waitFor(() => expect(fab()).not.toBeNull());
  });

  it('drops the FAB when the last archived object is deleted', async () => {
    const { setList } = renderPage([LIVE, DONE]);
    await waitFor(() => expect(fab()).not.toBeNull());

    await setList([LIVE]);

    await waitFor(() => expect(fab()).toBeNull());
  });

  it('drops the FAB even when the reveal is currently ON — the old `|| showArchived` kept it', async () => {
    localStorage.setItem('majstr-projects-show-archived', '1');
    const { setList } = renderPage([LIVE, DONE]);
    await waitFor(() => expect(screen.queryByText('Завершені · 1')).not.toBeNull());

    await setList([LIVE]);

    await waitFor(() => expect(fab()).toBeNull());
    expect(screen.queryByText(/Завершені/)).toBeNull();
    expect(screen.queryByText(/Скасовані/)).toBeNull();
  });

  it('never shows a terminal object without the reveal, so «Усі» still counts live only', async () => {
    renderPage([LIVE, DONE]);
    await waitFor(() => expect(screen.queryByText('Усі · 1')).not.toBeNull());
    expect(screen.queryByText('Обʼєкт p2')).toBeNull();
  });

  it('bounces off a terminal chip once its last object is gone', async () => {
    localStorage.setItem('majstr-projects-show-archived', '1');
    const { setList } = renderPage([LIVE, DONE], '/projects?stage=COMPLETED');
    await waitFor(() => expect(screen.queryByText('Обʼєкт p2')).not.toBeNull());
    expect(location).toBe('/projects?stage=COMPLETED');

    await setList([LIVE]);

    await waitFor(() => expect(location).toBe('/projects'));
    expect(screen.queryByText('Обʼєкт p1')).not.toBeNull();
  });

  it('holds a ?stage=COMPLETED deep link while the list is still loading', async () => {
    // `all` is empty before the first response — bouncing off that would break every deep link from
    // the dashboard's «Завершено» card.
    renderPage([LIVE, DONE], '/projects?stage=COMPLETED');
    expect(location).toBe('/projects?stage=COMPLETED');
    await waitFor(() => expect(screen.queryByText('Обʼєкт p2')).not.toBeNull());
    expect(location).toBe('/projects?stage=COMPLETED');
  });
});
