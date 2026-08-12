import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ProjectRowMenu } from './ProjectRowMenu.tsx';
import { ProjectCard } from '@/components/ProjectCard.tsx';
import { messageLinkApi } from '@/api/messageLink.ts';
import { projectsApi } from '@/api/projects.ts';
import { toast } from '@/hooks/useToast.ts';
import type { ProjectResponse } from '@/api/types.ts';

/**
 * The object list row's ⋮: the chat link (unchanged from the old `ChatLinkRowButton`) plus the
 * object status transitions that used to live only on the object's own hero menu — moved here so
 * a master doesn't have to open an object just to close it out.
 */
vi.mock('@/api/messageLink.ts', () => ({
  messageLinkApi: { state: vi.fn(), revoke: vi.fn() },
}));
vi.mock('@/api/projects.ts', () => ({
  projectsApi: { setStatus: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

function setClipboard(impl: ((text: string) => Promise<void>) | null) {
  Object.defineProperty(navigator, 'clipboard', {
    value: impl ? { writeText: vi.fn(impl) } : undefined,
    configurable: true,
    writable: true,
  });
}

function project(overrides: Partial<ProjectResponse> = {}): ProjectResponse {
  return {
    id: 'p1', name: 'Квартира', address: 'вул. 1', status: 'IN_PROGRESS', stage: 'IN_PROGRESS',
    clientFullName: null, clientId: null, description: null,
    unreadQuestions: 0, latestEstimateTotal: null, estimateStatus: null,
    createdAt: '2026-07-20T10:00:00Z',
    ...overrides,
  } as unknown as ProjectResponse;
}

function renderMenu(p: ProjectResponse = project()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><ProjectRowMenu project={p} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  onlineManager.setOnline(true);
  setClipboard(() => Promise.resolve());
  vi.mocked(messageLinkApi.state).mockResolvedValue({
    url: 'https://majstr.pro/message/index.html?m=tok',
  });
});

describe('ProjectRowMenu — chat link', () => {
  const openMenu = async (p?: ProjectResponse) => {
    renderMenu(p);
    fireEvent.click(screen.getByRole('button', { name: /Квартира/ }));
    return screen.findByRole('menuitem', { name: /Скопіювати посилання/ });
  };

  it('mints the link and copies it', async () => {
    fireEvent.click(await openMenu());

    await waitFor(() => expect(messageLinkApi.state).toHaveBeenCalledWith('p1'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://majstr.pro/message/index.html?m=tok',
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('does not claim success when the clipboard refuses, and shows the link instead', async () => {
    setClipboard(() => Promise.reject(new Error('denied')));

    fireEvent.click(await openMenu());

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls[0][0]).toContain('m=tok');
  });

  it('offers no revoke from a list row', async () => {
    await openMenu();

    expect(screen.queryByRole('menuitem', { name: /Відкликати посилання/ })).toBeNull();
  });

  it('the ⋮ on a list card opens the menu without opening the object', async () => {
    const p = project();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><ProjectCard project={p} /></MemoryRouter>
      </QueryClientProvider>,
    );

    // Scoped to "Дії з об'єктом" — the card's own nav button also has "Квартира" in its
    // accessible name (its text content), so matching on the project name alone is ambiguous here.
    const kebab = screen.getByRole('button', { name: /Дії з об.єктом/ });
    expect(screen.getByText('Квартира').closest('button')).not.toBe(kebab);

    fireEvent.click(kebab);

    expect(await screen.findByRole('menuitem', { name: /Скопіювати посилання/ })).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('ProjectRowMenu — object status actions', () => {
  it('an IN_PROGRESS object offers Завершити/Скасувати, and confirming completes it', async () => {
    vi.mocked(projectsApi.setStatus).mockResolvedValue(project({ stage: 'COMPLETED' }));
    renderMenu(project({ stage: 'IN_PROGRESS' }));

    fireEvent.click(screen.getByRole('button', { name: /Квартира/ }));
    expect(await screen.findByRole('menuitem', { name: /Завершити об.єкт/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Скасувати об.єкт/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: /Завершити об.єкт/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Завершити об.єкт/ }));

    await waitFor(() => expect(projectsApi.setStatus).toHaveBeenCalledWith('p1', 'COMPLETED'));
  });

  it('a COMPLETED object offers ONLY Повернути в роботу — no Завершити, no Скасувати, no chat link', async () => {
    renderMenu(project({ stage: 'COMPLETED' }));

    fireEvent.click(screen.getByRole('button', { name: /Квартира/ }));

    expect(await screen.findByRole('menuitem', { name: /Повернути в роботу/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^Завершити/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^Скасувати/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Скопіювати посилання/ })).toBeNull();
    expect(screen.queryByText(/жодних цін/)).toBeNull(); // the chat-link hint text too
  });

  it('a CANCELLED object offers ONLY Відновити — no Завершити, no Скасувати, no chat link', async () => {
    renderMenu(project({ stage: 'CANCELLED' }));

    fireEvent.click(screen.getByRole('button', { name: /Квартира/ }));

    expect(await screen.findByRole('menuitem', { name: /Відновити об.єкт/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^Скасувати/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^Завершити/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Скопіювати посилання/ })).toBeNull();
  });

  it('cancelling from the row menu calls setStatus(CANCELLED) after confirm', async () => {
    vi.mocked(projectsApi.setStatus).mockResolvedValue(project({ stage: 'CANCELLED' }));
    renderMenu(project({ stage: 'IN_PROGRESS' }));

    fireEvent.click(screen.getByRole('button', { name: /Квартира/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Скасувати об.єкт/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Скасувати об.єкт/ }));

    await waitFor(() => expect(projectsApi.setStatus).toHaveBeenCalledWith('p1', 'CANCELLED'));
  });
});
