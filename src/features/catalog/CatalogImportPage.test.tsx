import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { CatalogImportPage } from './CatalogImportPage.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { catalogImportApi } from '@/api/catalogImport.ts';
import type { CatalogImportParseResponse, UserResponse } from '@/api/types.ts';

vi.mock('@/api/catalogImport.ts', () => ({
  catalogImportApi: { parseFile: vi.fn(), parseText: vi.fn(), commit: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const me: UserResponse = {
  id: 'u1', email: 'm@e.com', fullName: 'M', trades: ['ELECTRICAL'], customTrades: [], phone: '1',
  companyName: 'C', logoUrl: null, plan: 'FREE', role: 'USER', emailVerified: true,
  createdAt: '2026-01-01', consentedToPrivacyAt: '2026-01-01', acknowledgedClientDataAt: '2026-01-01',
  planExpiresAt: null, autoRenew: false, cardMask: null, trialStartedAt: null, referralCode: 'refcode1',
};

const parseResult: CatalogImportParseResponse = {
  grid: [['Штроба', 'м.п.', '120'], ['Демонтаж', 'шт', '150']],
  rows: [
    { gridRow: 0, name: 'Штроба', unit: 'LINEAR_METER', price: 120, type: 'WORK', issues: [] },
    { gridRow: 1, name: 'Демонтаж', unit: 'PIECE', price: 150, type: 'WORK', issues: [] },
  ],
  skippedRows: 1,
  guessedMapping: { nameCol: 0, priceCol: 2, unitCol: 1 },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, me);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<CatalogImportPage />, { wrapper });
}

beforeEach(() => vi.clearAllMocks());

describe('CatalogImportPage — paste → review → commit', () => {
  it('parses pasted rows, then commits the confirmed list', async () => {
    vi.mocked(catalogImportApi.parseText).mockResolvedValue(parseResult);
    vi.mocked(catalogImportApi.commit).mockResolvedValue({ created: 2, updated: 0, skipped: 0 });

    renderPage();

    // Step 1 — paste and recognize.
    fireEvent.change(screen.getByPlaceholderText(/Штроба/), {
      target: { value: 'Штроба\tм.п.\t120\nДемонтаж\tшт\t150' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Розпізнати' }));

    // Step 2 — review shows the two recognized rows + skipped count.
    await waitFor(() => expect(screen.getByText(/Пропущено 1/)).toBeTruthy());

    // Commit the batch.
    fireEvent.click(screen.getByRole('button', { name: /Імпортувати 2/ }));

    await waitFor(() =>
      expect(catalogImportApi.commit).toHaveBeenCalledWith({
        items: [
          { name: 'Штроба', unit: 'LINEAR_METER', price: 120, type: 'WORK', policy: null },
          { name: 'Демонтаж', unit: 'PIECE', price: 150, type: 'WORK', policy: null },
        ],
        trade: 'ELECTRICAL', // single-trade master → auto-selected
        defaultPolicy: 'UPDATE_PRICE',
      }),
    );
  });

  it('blocks commit until a highlighted (missing-unit) row is fixed', async () => {
    vi.mocked(catalogImportApi.parseText).mockResolvedValue({
      ...parseResult,
      rows: [{ gridRow: 0, name: 'Фарбування', unit: null, price: 200, type: 'WORK', issues: ['unit'] }],
      grid: [['Фарбування', 'відро', '200']],
    });

    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/Штроба/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Розпізнати' }));

    await waitFor(() => expect(screen.getByRole('button', { name: /Імпортувати 1/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Імпортувати 1/ }));

    // Missing unit → commit is not called.
    await waitFor(() => expect(screen.getAllByText(/Виправте підсвічені/).length).toBeGreaterThan(0));
    expect(catalogImportApi.commit).not.toHaveBeenCalled();
  });
});
