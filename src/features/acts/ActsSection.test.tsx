import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ActsSection } from './ActsSection.tsx';
import { actsApi } from '@/api/acts.ts';
import type { WorkActResponse } from '@/api/types.ts';
import { toast } from '@/hooks/useToast.ts';

vi.mock('@/api/acts.ts', () => ({
  actsApi: { list: vi.fn(), create: vi.fn(), remove: vi.fn(), changeStatus: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

function act(over: Partial<WorkActResponse> = {}): WorkActResponse {
  return {
    id: 'a1', projectId: 'p1', number: '1', title: null, kind: 'INTERIM', status: 'DRAFT',
    issuedAt: '2026-08-14', periodFrom: '2026-08-01', periodTo: '2026-08-14',
    place: null, contractRef: null, note: null, showMaterials: true, showCumulative: true,
    receiptsToExpenses: true, showReceiptPhotos: true, advanceOffset: null, retentionPercent: null, sentAt: null, signedAt: null,
    signerName: null, signedOffline: false, addendumEstimateId: null, items: [], receipts: [],
    total: 0, receiptsTotal: 0, payable: 0, createdAt: '2026-08-14', updatedAt: '2026-08-14',
    ...over,
  };
}

/** Prints the current URL so a navigation can be asserted on. */
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        {children}
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<ActsSection objectId="p1" objectCreatedAt="2026-08-01T00:00:00Z" />, { wrapper });
}

beforeEach(() => vi.clearAllMocks());

describe('ActsSection', () => {
  it('empty object: the «＋» is the ONE create action, and the teaching empty state shows', async () => {
    vi.mocked(actsApi.list).mockResolvedValue([]);

    renderSection();

    expect(await screen.findByText('Актів ще немає')).toBeTruthy();
    // The dashed «+ Новий акт» beside the «＋» was the same action twice.
    expect(screen.getAllByRole('button', { name: '+ Новий акт' })).toHaveLength(1);
  });

  it('«+ Новий акт» only opens the editor — nothing is created until «Зберегти»', async () => {
    // Master feedback: a mistaken tap plus a Back used to leave a real numbered act on the object.
    vi.mocked(actsApi.list).mockResolvedValue([act({ status: 'SIGNED', periodTo: '2026-08-14' })]);

    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: '+ Новий акт' }));

    expect(actsApi.create).not.toHaveBeenCalled();
    // The period start still comes from this side (it knows the object's acts) — via the URL now.
    expect(screen.getByTestId('loc').textContent)
      .toBe('/acts/new?project=p1&from=2026-08-15');
  });

  it('an open (DRAFT/SENT) act blocks creating another', async () => {
    vi.mocked(actsApi.list).mockResolvedValue([act({ status: 'SENT' })]);

    renderSection();

    expect(await screen.findByText('Спершу завершіть відкритий акт')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ Новий акт' }));
    expect(toast.info).toHaveBeenCalledWith('Спершу завершіть відкритий акт');
    expect(screen.getByTestId('loc').textContent).toBe('/');
  });

  it('a FINAL act closes the object to any further acts', async () => {
    vi.mocked(actsApi.list).mockResolvedValue([act({ kind: 'FINAL', status: 'SIGNED' })]);

    renderSection();

    expect(await screen.findByText(/фінальним актом/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ Новий акт' }));
    expect(screen.getByTestId('loc').textContent).toBe('/');
  });

  it('a SENT act offers recall and «client declined» — the exits REJECTED was built for', async () => {
    vi.mocked(actsApi.list).mockResolvedValue([act({ status: 'SENT' })]);
    vi.mocked(actsApi.changeStatus).mockResolvedValue(act({ status: 'REJECTED' }));

    renderSection();
    fireEvent.click(await screen.findByLabelText('Дії з актом'));
    fireEvent.click(await screen.findByText('Клієнт відхилив'));

    await waitFor(() => expect(actsApi.changeStatus).toHaveBeenCalledWith('a1', 'REJECTED'));
  });

  it('a custom stage name replaces the «Проміжний» word; FINAL always shows', async () => {
    vi.mocked(actsApi.list).mockResolvedValue([
      act({ id: 'a1', number: '1', title: 'Шпаклювання', kind: 'INTERIM', status: 'SIGNED' }),
      act({ id: 'a2', number: '2', title: 'Фінішні роботи', kind: 'FINAL', status: 'SIGNED' }),
    ]);

    renderSection();

    expect(await screen.findByText(/Акт № 1 — Шпаклювання$/)).toBeTruthy(); // no «Проміжний» tail
    expect(screen.getByText(/Акт № 2 — Фінішні роботи · Фінальний/)).toBeTruthy(); // FINAL stays
  });

  it('lists an act row with its number, kind and status badge', async () => {
    vi.mocked(actsApi.list).mockResolvedValue([act({ number: '3', kind: 'INTERIM', status: 'SIGNED' })]);

    renderSection();

    expect(await screen.findByText(/Акт № 3/)).toBeTruthy();
    expect(screen.getByText('Підписано')).toBeTruthy();
  });
});

describe('ActsSection — the «＋» (object-first)', () => {
  it('starts an act', async () => {
    vi.mocked(actsApi.list).mockResolvedValue([]);
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: '+ Новий акт' }));

    await waitFor(() => expect(screen.getByTestId('loc').textContent).toMatch(/^\/acts\/new\?project=p1/));
    expect(actsApi.create).not.toHaveBeenCalled();
  });

  it('with an open act it says why, and opens nothing', async () => {
    vi.mocked(actsApi.list).mockResolvedValue([act({ status: 'SENT' })]);
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: '+ Новий акт' }));

    expect(toast.info).toHaveBeenCalledWith('Спершу завершіть відкритий акт');
    expect(screen.getByTestId('loc').textContent).toBe('/');
  });
});
