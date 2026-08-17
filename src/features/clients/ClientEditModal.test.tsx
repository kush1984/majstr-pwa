import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ClientEditModal } from './ClientEditModal.tsx';
import type { ClientResponse } from '@/api/types.ts';

const mutateAsync = vi.fn(() => Promise.resolve());
const clientData: { current: ClientResponse } = {
  current: {
    id: 'c1', fullName: 'Іван Клієнт', phone: '+380671112233', address: null, email: null,
    clientType: 'PERSON', taxId: null, legalName: null, legalAddress: null,
    signatoryTitle: null, signatoryName: null, createdAt: '2026-01-01',
  },
};

vi.mock('./useClients.ts', () => ({
  useClient: () => ({ data: clientData.current, isPending: false }),
  useUpdateClient: () => ({ mutateAsync, isPending: false }),
}));

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  render(<ClientEditModal open onClose={() => {}} clientId="c1" />, { wrapper });
}

beforeEach(() => {
  mutateAsync.mockClear();
  clientData.current = { ...clientData.current, clientType: 'PERSON' };
});

describe('ClientEditModal — type switch reveals requisites', () => {
  it('a PERSON shows no legal-requisite fields', () => {
    renderModal();
    expect(screen.getByDisplayValue('Іван Клієнт')).toBeTruthy();
    expect(screen.queryByText('ЄДРПОУ')).toBeNull();
    expect(screen.queryByText('Посада підписанта')).toBeNull();
  });

  it('switching to Компанія reveals ЄДРПОУ + signatory and sends them on save', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Компанія' }));

    // Company-specific requisites appear.
    expect(screen.getByText('ЄДРПОУ')).toBeTruthy();
    expect(screen.getByText('Посада підписанта')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ req: expect.objectContaining({ clientType: 'COMPANY' }) }),
    ));
  });

  it('switching to ФОП labels the tax id as РНОКПП', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'ФОП' }));
    expect(screen.getByText('РНОКПП')).toBeTruthy();
    // No signatory block for a ФОП.
    expect(screen.queryByText('Посада підписанта')).toBeNull();
  });
});
