import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ConsolidateSheet } from './ConsolidateSheet.tsx';
import { estimatesApi } from '@/api/estimates.ts';
import type { EstimateSummary } from '@/api/types.ts';

vi.mock('@/api/estimates.ts', () => ({
  estimatesApi: { consolidate: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const estimates: EstimateSummary[] = [
  { id: 'e1', projectId: 'p1', name: 'Економ', status: 'DRAFT', validUntil: null, createdAt: '2026-01-01', updatedAt: '', countInEconomy: false },
  { id: 'e2', projectId: 'p1', name: 'Преміум', status: 'SENT', validUntil: null, createdAt: '2026-01-02', updatedAt: '', countInEconomy: false },
];

function renderSheet(onDone: (id: string) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <ConsolidateSheet open onClose={() => {}} projectId="p1" estimates={estimates} onDone={onDone} />,
    { wrapper },
  );
}

beforeEach(() => vi.clearAllMocks());

describe('ConsolidateSheet', () => {
  it('requires at least two estimates before submitting', () => {
    renderSheet(() => {});
    // Nothing picked → the button shows the "pick at least two" state and is disabled.
    const btn = screen.getByRole('button', { name: /щонайменше два/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('consolidates the picked estimates and reports the new id', async () => {
    vi.mocked(estimatesApi.consolidate).mockResolvedValue({
      id: 'new1', projectId: 'p1', name: 'Зведений кошторис', status: 'DRAFT',
      validUntil: null, notes: null, createdAt: '', updatedAt: '', items: [],
      worksSubtotal: 0, materialsSubtotal: 0, total: 0, depositAmount: null, balance: 0,
    });
    const onDone = vi.fn();
    renderSheet(onDone);

    fireEvent.click(screen.getByText('Економ'));
    fireEvent.click(screen.getByText('Преміум'));
    fireEvent.click(screen.getByRole('button', { name: /Звести 2/i }));

    // The name field is pre-filled with the default title (editable), so it's sent along.
    await waitFor(() => expect(estimatesApi.consolidate).toHaveBeenCalledWith('p1', {
      name: 'Зведений кошторис',
      estimateIds: ['e1', 'e2'],
    }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('new1'));
  });
});
