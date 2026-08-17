import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ActsSection } from './ActsSection.tsx';
import { actsApi } from '@/api/acts.ts';
import type { WorkActResponse } from '@/api/types.ts';

vi.mock('@/api/acts.ts', () => ({
  actsApi: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

function act(over: Partial<WorkActResponse> = {}): WorkActResponse {
  return {
    id: 'a1', projectId: 'p1', number: '1', kind: 'INTERIM', status: 'DRAFT',
    issuedAt: '2026-08-14', periodFrom: '2026-08-01', periodTo: '2026-08-14',
    place: null, contractRef: null, note: null, showMaterials: true, showCumulative: true,
    advanceOffset: null, retentionPercent: null, sentAt: null, signedAt: null,
    signerName: null, signedOffline: false, addendumEstimateId: null, items: [],
    total: 0, payable: 0, createdAt: '2026-08-14', updatedAt: '2026-08-14',
    ...over,
  };
}

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<ActsSection objectId="p1" objectCreatedAt="2026-08-01T00:00:00Z" />, { wrapper });
}

beforeEach(() => vi.clearAllMocks());

describe('ActsSection', () => {
  it('empty object: «+ Новий акт» is enabled and the teaching empty state shows', async () => {
    vi.mocked(actsApi.list).mockResolvedValue([]);

    renderSection();

    const btn = await screen.findByText('+ Новий акт');
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('Актів ще немає')).toBeTruthy();
  });

  it('an open (DRAFT/SENT) act blocks creating another', async () => {
    vi.mocked(actsApi.list).mockResolvedValue([act({ status: 'SENT' })]);

    renderSection();

    const btn = await screen.findByText('+ Новий акт');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Спершу завершіть відкритий акт')).toBeTruthy();
  });

  it('a FINAL act closes the object to any further acts', async () => {
    vi.mocked(actsApi.list).mockResolvedValue([act({ kind: 'FINAL', status: 'SIGNED' })]);

    renderSection();

    const btn = await screen.findByText('+ Новий акт');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/фінальним актом/)).toBeTruthy();
  });

  it('lists an act row with its number, kind and status badge', async () => {
    vi.mocked(actsApi.list).mockResolvedValue([act({ number: '3', kind: 'INTERIM', status: 'SIGNED' })]);

    renderSection();

    expect(await screen.findByText(/Акт № 3/)).toBeTruthy();
    expect(screen.getByText('Підписано')).toBeTruthy();
  });
});
