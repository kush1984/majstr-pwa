import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { SharePortalSheet } from './SharePortalSheet.tsx';
import { portalApi } from '@/api/portal.ts';
import type { PortalStateResponse, ProjectResponse } from '@/api/types.ts';

vi.mock('@/api/portal.ts', () => ({
  portalApi: { state: vi.fn(), update: vi.fn(), sendEmail: vi.fn() },
}));
vi.mock('@/features/clients/useClients.ts', () => ({
  useClient: () => ({ data: { id: 'c1', fullName: 'Клієнт', phone: '+380', email: 'client@x.ua' } }),
  useCreateClient: () => ({ isPending: false }),
  useUpdateClient: () => ({ isPending: false }),
}));
vi.mock('@/features/projects/useProjects.ts', () => ({
  useUpdateProject: () => ({ isPending: false }),
}));
vi.mock('@/features/clients/ClientPicker.tsx', () => ({
  ClientPicker: () => null,
  clientDraftError: () => null,
  resolveClientId: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

const project = {
  id: 'p1', name: 'Квартира', address: 'вул. Тестова 1', clientId: 'c1',
} as ProjectResponse;

const state: PortalStateResponse = {
  url: 'https://majstr.pro/portal/index.html?p=tok',
  estimates: [
    { id: 'e1', name: 'Економ', status: 'SENT', createdAt: '2026-07-01T00:00:00Z', visible: true },
    { id: 'e2', name: 'Преміум', status: 'DRAFT', createdAt: '2026-07-02T00:00:00Z', visible: false },
  ],
};

function renderSheet(preselect?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  render(
    <SharePortalSheet open onClose={() => {}} project={project}
      preselectEstimateId={preselect} onNeedEmailVerify={() => {}} />,
    { wrapper },
  );
}

describe('SharePortalSheet', () => {
  it('seeds the checkboxes from the server visibility state', async () => {
    vi.mocked(portalApi.state).mockResolvedValue(state);
    renderSheet();

    await waitFor(() => expect(screen.getByText('Економ')).toBeTruthy());
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.map((b) => b.checked)).toEqual([true, false]);
  });

  it('publishes exactly the ticked set before copying the link', async () => {
    vi.mocked(portalApi.state).mockResolvedValue(state);
    vi.mocked(portalApi.update).mockResolvedValue(state);
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    renderSheet();
    await waitFor(() => expect(screen.getByText('Преміум')).toBeTruthy());

    // Tick «Преміум» in addition to the already-visible «Економ».
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: /Копіювати посилання/ }));

    await waitFor(() => expect(portalApi.update).toHaveBeenCalled());
    const ids = vi.mocked(portalApi.update).mock.calls[0][1];
    expect([...ids].sort()).toEqual(['e1', 'e2']);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(state.url);
  });

  it('pre-ticks the editor estimate on top of the server state', async () => {
    vi.mocked(portalApi.state).mockResolvedValue(state);
    renderSheet('e2');

    await waitFor(() => expect(screen.getByText('Преміум')).toBeTruthy());
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.map((b) => b.checked)).toEqual([true, true]);
  });

  it('unticking everything offers "hide all" instead of copy', async () => {
    vi.mocked(portalApi.state).mockResolvedValue(state);
    vi.mocked(portalApi.update).mockResolvedValue({ ...state, estimates: [] });
    renderSheet();
    await waitFor(() => expect(screen.getByText('Економ')).toBeTruthy());

    fireEvent.click(screen.getAllByRole('checkbox')[0]); // untick the only visible one
    const hideBtn = await screen.findByRole('button', { name: /Прибрати все/ });
    fireEvent.click(hideBtn);

    await waitFor(() => expect(portalApi.update).toHaveBeenCalledWith('p1', []));
  });
});
