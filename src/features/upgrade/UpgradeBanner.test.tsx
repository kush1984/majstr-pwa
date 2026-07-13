import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { UpgradeBanner } from '@/components/UpgradeBanner.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { upgradeApi } from '@/api/upgrade.ts';
import { billingApi } from '@/api/billing.ts';
import type { UserResponse } from '@/api/types.ts';

vi.mock('@/api/upgrade.ts', () => ({
  upgradeApi: { click: vi.fn(() => Promise.resolve()), interest: vi.fn(() => Promise.resolve()) },
}));
vi.mock('@/api/billing.ts', () => ({
  billingApi: { checkout: vi.fn(() => Promise.resolve({ pageUrl: 'https://pay.monobank.ua/abc' })) },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const me: UserResponse = {
  id: 'u1', email: 'master@e.com', fullName: 'M', trades: ['ELECTRICAL'], phone: '1',
  companyName: 'C', logoUrl: null, plan: 'FREE', role: 'USER', emailVerified: true,
  createdAt: '2026-01-01', consentedToPrivacyAt: '2026-01-01', acknowledgedClientDataAt: '2026-01-01',
  planExpiresAt: null, autoRenew: false, cardMask: null, trialStartedAt: null, referralCode: 'refcode1',
};

function renderBanner() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, me);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<UpgradeBanner text="Ліміт вичерпано" trigger="OBJECT_LIMIT" />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('UpgradeBanner — PRO checkout', () => {
  it('records the click with its trigger, opens the PRO modal, then starts checkout', async () => {
    renderBanner();

    // Click the CTA → analytics click recorded with the trigger + PRO modal opens.
    fireEvent.click(screen.getByRole('button', { name: /PRO/ }));
    expect(upgradeApi.click).toHaveBeenCalledWith('OBJECT_LIMIT');
    expect(await screen.findByText('Оновити до PRO')).toBeTruthy();

    // "Оплатити" starts a real monobank checkout.
    fireEvent.click(screen.getByRole('button', { name: 'Оплатити' }));
    await waitFor(() => expect(billingApi.checkout).toHaveBeenCalled());
  });
});
