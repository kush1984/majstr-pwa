import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
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

/** The archive switch — a chip in the filter row now, no longer behind the FAB (objects-list). */
const archiveChip = () => screen.queryByRole('button', { name: /^Архів · / });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  location = '';
});

describe('ProjectsPage — the archived reveal follows the data', () => {
  it('offers the archive chip while a terminal object exists', async () => {
    renderPage([LIVE, DONE]);
    await waitFor(() => expect(archiveChip()).not.toBeNull());
  });

  it('drops the archive chip when the last archived object is deleted', async () => {
    const { setList } = renderPage([LIVE, DONE]);
    await waitFor(() => expect(archiveChip()).not.toBeNull());

    await setList([LIVE]);

    await waitFor(() => expect(archiveChip()).toBeNull());
  });

  it('drops the archive chip even when the reveal is currently ON — the old `|| showArchived` kept it', async () => {
    localStorage.setItem('majstr-projects-show-archived', '1');
    const { setList } = renderPage([LIVE, DONE]);
    await waitFor(() => expect(screen.queryByText('Завершені · 1')).not.toBeNull());

    await setList([LIVE]);

    await waitFor(() => expect(archiveChip()).toBeNull());
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
    // Two commits, not one: the effect navigates, and the list re-renders under the new filter one
    // tick later. Asserting the list synchronously after the URL flipped raced that second commit.
    await waitFor(() => expect(screen.queryByText('Обʼєкт p1')).not.toBeNull());
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

/**
 * A master whose objects are all closed out used to land on «Усі · 0 — Нічого не знайдено» with no
 * way to start a new one: the «＋» opened the archive switch (objects-list).
 */
describe('ProjectsPage — never a dead end', () => {
  it('everything archived and hidden: the create buttons, and «Показати архів (N)»', async () => {
    renderPage([DONE, project('p3', 'CANCELLED')]);

    // The empty state's own button (besides the header's and the «＋»).
    expect(await screen.findByText('Активних обʼєктів немає')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: "Новий об'єкт" }).length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText('Нічого не знайдено')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Показати архів (2)' }));

    await waitFor(() => expect(screen.queryByText('Обʼєкт p2')).not.toBeNull());
    expect(localStorage.getItem('majstr-projects-show-archived')).toBe('1');
  });

  it('a narrow filter with nothing in it still offers to create', async () => {
    renderPage([LIVE], '/projects?stage=ASSESSMENT');

    expect(await screen.findByText('Нічого не знайдено')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: "Новий об'єкт" }).length).toBeGreaterThanOrEqual(3);
  });

  it('the «＋» creates an OBJECT — a direct action, no menu (object-first)', async () => {
    renderPage([LIVE, DONE]);
    await screen.findByText('Обʼєкт p1');

    const fabButtons = screen.getAllByRole('button', { name: "Новий об'єкт" });
    const fab = fabButtons[fabButtons.length - 1];
    expect(fab.getAttribute('aria-expanded')).toBeNull();
    fireEvent.click(fab);

    await waitFor(() => expect(location).toBe('/projects/new'));
  });

  it('the archive chip shows the completed and cancelled objects', async () => {
    renderPage([LIVE, DONE]);
    await waitFor(() => expect(archiveChip()).not.toBeNull());
    expect(screen.queryByText('Обʼєкт p2')).toBeNull();

    fireEvent.click(archiveChip()!);

    await waitFor(() => expect(screen.queryByText('Обʼєкт p2')).not.toBeNull());
  });
});
