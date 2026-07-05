import { useState } from 'react';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ClientPicker, emptyClientDraft, type ClientDraft } from './ClientPicker.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { clientsApi } from '@/api/clients.ts';
import { profileApi } from '@/api/profile.ts';
import type { UserResponse } from '@/api/types.ts';

vi.mock('@/api/clients.ts', () => ({ clientsApi: { list: vi.fn() } }));
vi.mock('@/api/profile.ts', () => ({ profileApi: { acknowledgeClientData: vi.fn() } }));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

function meWith(ackAt: string | null): UserResponse {
  return {
    id: 'u1', email: 'm@e.com', fullName: 'M', trades: ['ELECTRICAL'], phone: '1',
    companyName: 'C', logoUrl: null, plan: 'FREE', role: 'USER', emailVerified: true,
    createdAt: '2026-01-01', consentedToPrivacyAt: '2026-01-01', acknowledgedClientDataAt: ackAt,
    planExpiresAt: null, autoRenew: false, cardMask: null,
  };
}

function Harness() {
  const [draft, setDraft] = useState<ClientDraft>(emptyClientDraft);
  return <ClientPicker value={draft} onChange={setDraft} />;
}

function renderPicker(me: UserResponse) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, me);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<Harness />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clientsApi.list).mockResolvedValue([]);
});

describe('ClientPicker — client-data acknowledgement gate', () => {
  it('not yet acknowledged: "Новий" opens the ack modal, confirming proceeds + stamps', async () => {
    vi.mocked(profileApi.acknowledgeClientData).mockResolvedValue(meWith('2026-06-30'));
    const { container } = renderPicker(meWith(null));

    // Switching to "Новий" is intercepted by the acknowledgement modal.
    fireEvent.click(screen.getByRole('button', { name: 'Новий' }));
    expect(await screen.findByText('Дані клієнта')).toBeTruthy();
    expect(container.querySelector('#cp-name')).toBeNull(); // not switched yet

    // Confirm → stamp recorded and the new-client fields appear.
    fireEvent.click(screen.getByRole('button', { name: 'Зрозуміло, підтверджую' }));
    await waitFor(() => expect(profileApi.acknowledgeClientData).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('#cp-name')).not.toBeNull());
  });

  it('already acknowledged: "Новий" switches straight to the form, no modal', async () => {
    const { container } = renderPicker(meWith('2026-05-01'));

    fireEvent.click(screen.getByRole('button', { name: 'Новий' }));
    await waitFor(() => expect(container.querySelector('#cp-name')).not.toBeNull());
    expect(screen.queryByText('Дані клієнта')).toBeNull();
    expect(profileApi.acknowledgeClientData).not.toHaveBeenCalled();
  });
});
