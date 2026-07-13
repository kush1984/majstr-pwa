import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ObjectEconomySection } from './ObjectEconomySection.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { economyApi } from '@/api/economy.ts';
import { upgradeApi } from '@/api/upgrade.ts';
import type { UserResponse } from '@/api/types.ts';

vi.mock('@/api/economy.ts', () => ({
  economyApi: {
    economy: vi.fn(),
    listExpenses: vi.fn(),
    addExpense: vi.fn(),
    updateExpense: vi.fn(),
    deleteExpense: vi.fn(),
  },
}));
vi.mock('@/api/upgrade.ts', () => ({ upgradeApi: { click: vi.fn(() => Promise.resolve()) } }));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

function baseMe(plan: UserResponse['plan']): UserResponse {
  return {
    id: 'u1', email: 'm@e.com', fullName: 'M', trades: ['ELECTRICAL'], phone: '1',
    companyName: 'C', logoUrl: null, plan, role: 'USER', emailVerified: true,
    createdAt: '2026-01-01', consentedToPrivacyAt: '2026-01-01', acknowledgedClientDataAt: '2026-01-01',
    planExpiresAt: null, autoRenew: false, cardMask: null, trialStartedAt: null, referralCode: 'refcode1',
  };
}

function renderSection(plan: UserResponse['plan']) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, baseMe(plan));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<ObjectEconomySection objectId="p1" />, { wrapper });
}

beforeEach(() => vi.clearAllMocks());

describe('ObjectEconomySection', () => {
  it('FREE: shows a locked teaser (no figures) and opens the upgrade modal on click', () => {
    renderSection('FREE');

    expect(screen.getByText(/у PRO/)).toBeTruthy();
    // No economy fetch for FREE (query disabled).
    expect(economyApi.economy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(/Відкрити PRO/));
    expect(upgradeApi.click).toHaveBeenCalledWith('OBJECT_PROFIT');
  });

  it('PRO: shows profit / negative cash + the works/materials breakdown and the expense list', async () => {
    // Store-run: deposit 3000, receipts 5000 → materials cash −2000; profit = works − manual.
    vi.mocked(economyApi.economy).mockResolvedValue({
      works: 15000, materials: 6000, received: 3000,
      spentReceipts: 5000, spentManual: 0, profit: 15000, cashBalance: -2000,
    });
    vi.mocked(economyApi.listExpenses).mockResolvedValue([
      { id: 'e1', amount: 450, category: 'MATERIALS', source: 'MANUAL', note: 'клей', spentAt: '2026-07-01', createdAt: '' },
    ]);

    renderSection('PRO');

    await waitFor(() => expect(economyApi.economy).toHaveBeenCalledWith('p1'));
    // Panel renders once the summary resolves (Spinner → figures).
    expect(await screen.findByText('Заробіток')).toBeTruthy();
    expect(screen.getByText('Каса (матеріали)')).toBeTruthy();
    expect(screen.getByText('Роботи')).toBeTruthy();
    // The teaser must NOT show for PRO.
    expect(screen.queryByText(/у PRO$/)).toBeNull();
    // The logged expense (its note) appears in the journal.
    expect(await screen.findByText(/клей/)).toBeTruthy();
  });
});
