import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { EstimateImportPage } from './EstimateImportPage.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { estimateImportApi } from '@/api/estimateImport.ts';
import type { EstimateImportParseResponse, Plan, UserResponse } from '@/api/types.ts';

vi.mock('@/api/estimateImport.ts', () => ({
  estimateImportApi: { parseFile: vi.fn(), commit: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

function meWith(plan: Plan): UserResponse {
  return {
    id: 'u1', email: 'm@e.com', fullName: 'M', trades: ['ELECTRICAL'], phone: '1',
    companyName: 'C', logoUrl: null, plan, role: 'USER', emailVerified: true,
    createdAt: '2026-01-01', consentedToPrivacyAt: '2026-01-01', acknowledgedClientDataAt: '2026-01-01',
    planExpiresAt: null, autoRenew: false, cardMask: null, referralCode: 'refcode1',
  };
}

const parseResult: EstimateImportParseResponse = {
  items: [
    { name: 'Малярка', unit: 'M2', quantity: 5, unitPrice: 100, type: 'WORK', category: 'Кухня', issues: [] },
    { name: 'Клей', unit: 'PIECE', quantity: 3, unitPrice: 50, type: 'MATERIAL', category: null, issues: [] },
  ],
  depositAmount: 500,
};

function renderPage(plan: Plan = 'PRO') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, meWith(plan));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/estimates/import?projectId=p1']}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<EstimateImportPage />, { wrapper });
}

function pickFile(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], 'kosht.csv', { type: 'text/csv' })] } });
}

beforeEach(() => vi.clearAllMocks());

describe('EstimateImportPage', () => {
  it('FREE user sees the PRO upsell, not the uploader', () => {
    const { container } = renderPage('FREE');
    expect(screen.getByText(/у PRO/)).toBeTruthy();
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it('parses a file, then commits a ready estimate with catalog + deposit', async () => {
    vi.mocked(estimateImportApi.parseFile).mockResolvedValue(parseResult);
    vi.mocked(estimateImportApi.commit).mockResolvedValue({
      estimateId: 'e1', total: 650, catalogCreated: 0, catalogUpdated: 0, catalogSkipped: 2,
    });

    const { container } = renderPage('PRO');
    pickFile(container);

    // Review appears with the extracted rows.
    await waitFor(() => expect(screen.getByRole('button', { name: /Створити кошторис/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Створити кошторис/ }));

    await waitFor(() => expect(estimateImportApi.commit).toHaveBeenCalled());
    const arg = vi.mocked(estimateImportApi.commit).mock.calls[0][0];
    expect(arg.projectId).toBe('p1');
    expect(arg.depositAmount).toBe(500);
    expect(arg.items).toHaveLength(2);
    // Default: ticked into the catalog, SKIP on conflict; category preserved / nulled.
    expect(arg.items[0]).toEqual({
      name: 'Малярка', unit: 'M2', quantity: 5, unitPrice: 100, type: 'WORK',
      category: 'Кухня', toCatalog: true, catalogPolicy: 'SKIP',
    });
    expect(arg.items[1].category).toBeNull();
  });

  it('commits a row with quantity 0 (price known, count comes later)', async () => {
    vi.mocked(estimateImportApi.parseFile).mockResolvedValue({
      items: [{ name: 'Монтаж світильника', unit: 'PIECE', quantity: 0, unitPrice: 100, type: 'WORK', category: null, issues: ['quantity'] }],
      depositAmount: null,
    });
    vi.mocked(estimateImportApi.commit).mockResolvedValue({
      estimateId: 'e2', total: 0, catalogCreated: 1, catalogUpdated: 0, catalogSkipped: 0,
    });

    const { container } = renderPage('PRO');
    pickFile(container);

    await waitFor(() => expect(screen.getByRole('button', { name: /Створити кошторис/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Створити кошторис/ }));

    await waitFor(() => expect(estimateImportApi.commit).toHaveBeenCalled());
    const arg = vi.mocked(estimateImportApi.commit).mock.calls[0][0];
    expect(arg.items[0].quantity).toBe(0);
    expect(arg.items[0].unitPrice).toBe(100);
  });

  it('allows 0 quantity/price but blocks a row missing its unit', async () => {
    vi.mocked(estimateImportApi.parseFile).mockResolvedValue({
      // A master often knows the price but not the count yet → quantity 0 is fine;
      // only the missing unit blocks the commit.
      items: [{ name: 'Монтаж світильника', unit: null, quantity: 0, unitPrice: 100, type: 'WORK', category: null, issues: ['unit', 'quantity'] }],
      depositAmount: null,
    });

    const { container } = renderPage('PRO');
    pickFile(container);

    await waitFor(() => expect(screen.getByRole('button', { name: /Створити кошторис/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Створити кошторис/ }));

    await waitFor(() => expect(screen.getAllByText(/Вкажіть одиницю/).length).toBeGreaterThan(0));
    expect(estimateImportApi.commit).not.toHaveBeenCalled();
  });
});
