import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { NewEstimatePage } from './NewEstimatePage.tsx';
import { projectsApi } from '@/api/projects.ts';
import { clientsApi } from '@/api/clients.ts';
import { estimatesApi } from '@/api/estimates.ts';
import { estimateTemplatesApi } from '@/api/estimateTemplates.ts';
import type { ProjectResponse } from '@/api/types.ts';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('@/api/projects.ts', () => ({ projectsApi: { list: vi.fn(), create: vi.fn() } }));
vi.mock('@/api/clients.ts', () => ({ clientsApi: { list: vi.fn(), create: vi.fn() } }));
vi.mock('@/api/estimates.ts', () => ({ estimatesApi: { createForProject: vi.fn() } }));
vi.mock('@/api/estimateTemplates.ts', () => ({
  estimateTemplatesApi: { list: vi.fn(), applyToProject: vi.fn() },
}));
vi.mock('@/api/plan.ts', () => ({ planApi: { limits: vi.fn() } }));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const proj: ProjectResponse = {
  id: 'p1', name: 'Хата', address: 'вул. 1', status: 'IN_PROGRESS', description: null,
  clientId: null, clientFullName: null, latestEstimateTotal: null, estimateStatus: null,
  unreadQuestions: 0, completedAt: null, createdAt: '', updatedAt: '',
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<NewEstimatePage />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(projectsApi.list).mockResolvedValue([]);
  vi.mocked(clientsApi.list).mockResolvedValue([]);
  vi.mocked(estimateTemplatesApi.list).mockResolvedValue([]);
});

describe('NewEstimatePage — optional client', () => {
  it('creates object + estimate WITHOUT a client (default none)', async () => {
    vi.mocked(projectsApi.create).mockResolvedValue(proj);
    vi.mocked(estimatesApi.createForProject).mockResolvedValue({ id: 'e1' } as never);

    const { container } = renderPage();
    fireEvent.change(container.querySelector('#pr-name')!, { target: { value: 'Хата' } });
    fireEvent.change(container.querySelector('#pr-addr')!, { target: { value: 'вул. 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Створити' }));

    await waitFor(() =>
      expect(projectsApi.create).toHaveBeenCalledWith({
        name: 'Хата', address: 'вул. 1', clientId: undefined,
      }),
    );
    expect(clientsApi.create).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(estimatesApi.createForProject).toHaveBeenCalledWith('p1', { name: undefined }),
    );
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/estimates/e1', { replace: true }));
  });
});
