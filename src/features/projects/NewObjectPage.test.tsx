import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { NewObjectPage } from './NewObjectPage.tsx';
import { projectsApi } from '@/api/projects.ts';
import { clientsApi } from '@/api/clients.ts';
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
  id: 'p9', name: 'Хата', address: 'вул. 1', status: 'IN_PROGRESS', description: null,
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
    fireEvent.click(screen.getByRole('button', { name: 'Створити' }));

    await waitFor(() =>
      expect(projectsApi.create).toHaveBeenCalledWith(
        { name: 'Хата', address: 'вул. 1', clientId: undefined }, expect.any(String),
      ),
    );
    expect(clientsApi.create).not.toHaveBeenCalled();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/projects/p9', { replace: true }));
  });

  it('creates a NEW client inline when chosen, then the object', async () => {
    vi.mocked(clientsApi.create).mockResolvedValue({
      id: 'c5', fullName: 'Олег', phone: '0991112233', email: null, address: null, createdAt: '',
    });
    vi.mocked(projectsApi.create).mockResolvedValue(proj);

    const { container } = renderPage();
    fireEvent.change(container.querySelector('#pr-name')!, { target: { value: 'Хата' } });
    fireEvent.change(container.querySelector('#pr-addr')!, { target: { value: 'вул. 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Новий' }));
    fireEvent.change(container.querySelector('#cp-name')!, { target: { value: 'Олег' } });
    fireEvent.change(container.querySelector('#cp-phone')!, { target: { value: '0991112233' } });
    fireEvent.click(screen.getByRole('button', { name: 'Створити' }));

    await waitFor(() => expect(clientsApi.create).toHaveBeenCalled());
    await waitFor(() =>
      expect(projectsApi.create).toHaveBeenCalledWith(
        { name: 'Хата', address: 'вул. 1', clientId: 'c5' }, expect.any(String),
      ),
    );
  });
});
