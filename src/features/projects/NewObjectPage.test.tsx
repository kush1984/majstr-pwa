import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { NewObjectPage } from './NewObjectPage.tsx';
import { projectsApi } from '@/api/projects.ts';
import { toast } from '@/hooks/useToast.ts';
import { clientsApi } from '@/api/clients.ts';
import { planApi } from '@/api/plan.ts';
import { tokens } from '@/lib/tokens.ts';
import type { ProjectResponse } from '@/api/types.ts';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('@/api/projects.ts', () => ({ projectsApi: { list: vi.fn(), create: vi.fn() } }));
vi.mock('@/api/clients.ts', () => ({ clientsApi: { list: vi.fn(), create: vi.fn() } }));
vi.mock('@/api/plan.ts', () => ({ planApi: { limits: vi.fn() } }));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const proj: ProjectResponse = {
  id: 'p9', name: 'Хата', address: 'вул. 1', status: 'IN_PROGRESS', stage: 'IN_PROGRESS', description: null,
  clientId: null, clientFullName: null, latestEstimateTotal: null, estimateStatus: null,
  unreadQuestions: 0, completedAt: null, createdAt: '', updatedAt: '',
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<NewObjectPage />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(projectsApi.list).mockResolvedValue([]);
  vi.mocked(clientsApi.list).mockResolvedValue([]);
});

// Online (the vitest default): creates go straight to the API — now with a client-generated UUID
// as a 2nd arg (the X-Entity-Uuid for idempotent offline replay). Offline queueing is covered in
// useProjects.test / useClients.test.
describe('NewObjectPage', () => {
  it('creates an object with NO client (default) and opens it', async () => {
    vi.mocked(projectsApi.create).mockResolvedValue(proj);

    const { container } = renderPage();
    fireEvent.change(container.querySelector('#pr-name')!, { target: { value: 'Хата' } });
    fireEvent.change(container.querySelector('#pr-addr')!, { target: { value: 'вул. 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Створити обʼєкт' }));

    await waitFor(() =>
      expect(projectsApi.create).toHaveBeenCalledWith(
        { name: 'Хата', address: 'вул. 1', clientId: undefined }, expect.any(String),
      ),
    );
    expect(clientsApi.create).not.toHaveBeenCalled();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/projects/p9', { replace: true, state: { justCreated: true } }));
  });

  /** V192: a name is enough; the address can be added later in the object's header. */
  it('creates an object with a name and no address', async () => {
    vi.mocked(projectsApi.create).mockResolvedValue({ ...proj, address: undefined });

    const { container } = renderPage();
    fireEvent.change(container.querySelector('#pr-name')!, { target: { value: 'Ванна' } });
    fireEvent.click(screen.getByRole('button', { name: 'Створити обʼєкт' }));

    await waitFor(() =>
      expect(projectsApi.create).toHaveBeenCalledWith(
        { name: 'Ванна', address: undefined, clientId: undefined }, expect.any(String),
      ),
    );
  });

  it('still refuses an object with no name', async () => {
    const { container } = renderPage();
    fireEvent.change(container.querySelector('#pr-addr')!, { target: { value: 'вул. 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Створити обʼєкт' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Вкажіть назву об'єкта"));
    expect(projectsApi.create).not.toHaveBeenCalled();
  });

  it('creates a NEW client inline when chosen, then the object', async () => {
    vi.mocked(clientsApi.create).mockResolvedValue({
      id: 'c5', fullName: 'Олег', phone: '0991112233', email: null, address: null, clientType: 'PERSON',
      taxId: null, legalName: null, legalAddress: null, signatoryTitle: null, signatoryName: null, createdAt: '',
    });
    vi.mocked(projectsApi.create).mockResolvedValue(proj);

    const { container } = renderPage();
    fireEvent.change(container.querySelector('#pr-name')!, { target: { value: 'Хата' } });
    fireEvent.change(container.querySelector('#pr-addr')!, { target: { value: 'вул. 1' } });
    fireEvent.click(screen.getByRole('button', { name: /Клієнт — необов/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Новий' }));
    fireEvent.change(container.querySelector('#cp-name')!, { target: { value: 'Олег' } });
    fireEvent.change(container.querySelector('#cp-phone')!, { target: { value: '0991112233' } });
    fireEvent.click(screen.getByRole('button', { name: 'Створити обʼєкт' }));

    await waitFor(() => expect(clientsApi.create).toHaveBeenCalled());
    await waitFor(() =>
      expect(projectsApi.create).toHaveBeenCalledWith(
        { name: 'Хата', address: 'вул. 1', clientId: 'c5' }, expect.any(String),
      ),
    );
  });
});

describe('NewObjectPage — the one creation form (object-first)', () => {
  it('asks for the object only: no estimate name, no estimate kind; the client is a folded row', () => {
    renderPage();

    expect(screen.queryByText(/Назва кошторису/)).toBeNull();
    expect(screen.queryByText('З шаблону')).toBeNull();
    expect(screen.getByRole('button', { name: /Клієнт — необов/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Створити обʼєкт' })).toBeTruthy();
  });
});

describe('NewObjectPage — the FREE object cap', () => {
  const free = (projectsUsed: number) => ({
    plan: 'FREE' as const, maxProjects: 2, projectsUsed, maxEstimatesPerProject: null,
    maxPhotosPerObject: null, maxReceiptPhotosPerObject: null, trialDays: 7,
  });

  beforeEach(() => { vi.spyOn(tokens, 'hasAny').mockReturnValue(true); });

  it('at the cap the banner names the count, never a raw {{used}}', async () => {
    vi.mocked(planApi.limits).mockResolvedValue(free(2));

    renderPage();

    expect(await screen.findByText(/ви створили 2/)).toBeTruthy();
    expect(screen.queryByText(/\{\{/)).toBeNull();
  });

  it('reads the lifetime count, not the list: the sample in the list does not block', async () => {
    vi.mocked(planApi.limits).mockResolvedValue(free(1));
    vi.mocked(projectsApi.list).mockResolvedValue([proj, { ...proj, id: 's1', sample: true }]);

    renderPage();

    await waitFor(() => expect(planApi.limits).toHaveBeenCalled());
    expect(screen.queryByText(/ви створили/)).toBeNull();
  });
});
