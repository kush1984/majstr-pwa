import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ShareEstimateSheet } from './ShareEstimateSheet.tsx';
import { clientsApi } from '@/api/clients.ts';
import { projectsApi } from '@/api/projects.ts';
import { estimatesApi } from '@/api/estimates.ts';
import type { ClientResponse, ProjectResponse } from '@/api/types.ts';

vi.mock('@/api/clients.ts', () => ({
  clientsApi: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock('@/api/projects.ts', () => ({ projectsApi: { update: vi.fn() } }));
vi.mock('@/api/estimates.ts', () => ({
  estimatesApi: { createShareLink: vi.fn(), sendShareEmail: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const noClientProject: ProjectResponse = {
  id: 'p1', name: 'Квартира', address: 'вул. 1', status: 'IN_PROGRESS', description: null,
  clientId: null, clientFullName: null, latestEstimateTotal: null, estimateStatus: 'DRAFT',
  unreadQuestions: 0, completedAt: null, createdAt: '', updatedAt: '',
};
const client: ClientResponse = {
  id: 'c1', fullName: 'Олена', phone: '099', email: 'olena@example.com', address: null, createdAt: '',
};

function renderSheet() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <ShareEstimateSheet
      open
      onClose={() => {}}
      estimateId="e1"
      project={noClientProject}
      onNeedEmailVerify={() => {}}
    />,
    { wrapper },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clientsApi.list).mockResolvedValue([client]);
  vi.mocked(clientsApi.get).mockResolvedValue(client);
});

describe('ShareEstimateSheet — no client on the object', () => {
  it('prompts to add a client, attaches the chosen one to the project, then can email', async () => {
    vi.mocked(projectsApi.update).mockResolvedValue({ ...noClientProject, clientId: 'c1' });

    renderSheet();

    // Copy-link works without a client; the add-client prompt is shown.
    expect(screen.getByRole('button', { name: /Копіювати посилання/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Додати клієнта' }));

    // Pick the existing client and confirm.
    fireEvent.click(await screen.findByText('Олена'));
    const confirm = screen.getAllByRole('button', { name: 'Додати клієнта' }).at(-1)!;
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(projectsApi.update).toHaveBeenCalledWith('p1', {
        name: 'Квартира', address: 'вул. 1', description: undefined, clientId: 'c1',
      }),
    );
    expect(clientsApi.create).not.toHaveBeenCalled();

    // Once attached, the email option (client now resolvable, has email) appears.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /olena@example\.com/ })).toBeTruthy(),
    );
  });
});
