import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ProfilePage } from './ProfilePage.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { billingApi } from '@/api/billing.ts';
import type { UserResponse } from '@/api/types.ts';

// The self-serve PRO trial button — shown only for a FREE master who never used
// the trial, and it activates PRO via billingApi.startTrial.

vi.mock('@/api/billing.ts', () => ({
  billingApi: {
    // Returns the full updated profile (PRO, trial stamped) — the page writes it
    // straight into the me cache, so it must be a complete UserResponse.
    startTrial: vi.fn(() =>
      Promise.resolve({
        id: 'u1', email: 'm@e.com', fullName: 'M', trades: ['ELECTRICAL'], customTrades: [], phone: '1',
        companyName: 'C', logoUrl: null, plan: 'PRO', role: 'USER', emailVerified: true,
        createdAt: '2026-01-01', consentedToPrivacyAt: '2026-01-01', acknowledgedClientDataAt: '2026-01-01',
        planExpiresAt: '2026-07-18T00:00:00Z', autoRenew: false, cardMask: null,
        trialStartedAt: '2026-07-13T00:00:00Z', referralCode: 'refcode1',
        legalName: null, taxId: null, legalAddress: null, iban: null, bankName: null, vatPayer: false,
        vatId: null, taxGroup: null, taxRate: null, docCity: null, actNumberFormat: 'PLAIN',
      } as UserResponse),
    ),
    referralStats: vi.fn(() => Promise.resolve({ invited: 0, paid: 0, earnedDays: 0 })),
  },
}));
vi.mock('@/api/projects.ts', () => ({ projectsApi: { list: vi.fn(() => Promise.resolve([])) } }));
vi.mock('@/api/upgrade.ts', () => ({
  upgradeApi: { click: vi.fn(() => Promise.resolve()), interest: vi.fn(() => Promise.resolve()) },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('@/hooks/usePush.ts', () => ({
  usePush: () => ({ ready: true, supported: false, subscribed: false, enable: vi.fn(), disable: vi.fn() }),
}));
vi.mock('@/features/auth/useLogout.ts', () => ({ useLogout: () => vi.fn() }));
vi.mock('./useProfile.ts', () => ({
  useUploadLogo: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteLogo: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateProfile: () => ({ mutate: vi.fn(), isPending: false }),
  useAddCustomTrade: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRenameCustomTrade: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteCustomTrade: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const baseMe: UserResponse = {
  id: 'u1', email: 'm@e.com', fullName: 'M', trades: ['ELECTRICAL'], customTrades: [], phone: '1',
  companyName: 'C', logoUrl: null, plan: 'FREE', role: 'USER', emailVerified: true,
  createdAt: '2026-01-01', consentedToPrivacyAt: '2026-01-01', acknowledgedClientDataAt: '2026-01-01',
  planExpiresAt: null, autoRenew: false, cardMask: null, trialStartedAt: null, referralCode: 'refcode1',
  legalName: null, taxId: null, legalAddress: null, iban: null, bankName: null, vatPayer: false,
  vatId: null, taxGroup: null, taxRate: null, docCity: null, actNumberFormat: 'PLAIN',
};

function renderPage(me: UserResponse) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, me);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<ProfilePage />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProfilePage — PRO trial', () => {
  it('FREE + never used: shows the trial button and activates PRO on click', async () => {
    renderPage(baseMe);
    const btn = screen.getByRole('button', { name: /Спробувати PRO/ });
    fireEvent.click(btn);
    await waitFor(() => expect(billingApi.startTrial).toHaveBeenCalled());
  });

  it('already used the trial: button is hidden', () => {
    renderPage({ ...baseMe, trialStartedAt: '2026-06-01T00:00:00Z' });
    expect(screen.queryByRole('button', { name: /Спробувати PRO/ })).toBeNull();
  });

  it('PRO plan: button is hidden', () => {
    renderPage({ ...baseMe, plan: 'PRO', planExpiresAt: '2026-08-01T00:00:00Z' });
    expect(screen.queryByRole('button', { name: /Спробувати PRO/ })).toBeNull();
  });

  it('unverified email: button is visible but click asks to verify (no trial call)', async () => {
    renderPage({ ...baseMe, emailVerified: false });
    const btn = screen.getByRole('button', { name: /Спробувати PRO/ });
    fireEvent.click(btn);
    // Reminder dialog appears; the trial API is NOT called until verified. No PRO
    // (trial or paid) without a verified email — the only action is to verify.
    expect(await screen.findByText('Спочатку підтвердіть email')).toBeTruthy();
    expect(billingApi.startTrial).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Підтвердити email' })).toBeTruthy();
  });
});
