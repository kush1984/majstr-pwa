import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { VerifiedTrialCard } from './VerifiedTrialCard.tsx';
import { noteVerificationState } from '@/features/email/trialOffer.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { PLAN_LIMITS_KEY } from '@/features/plan/usePlanLimits.ts';
import { billingApi } from '@/api/billing.ts';
import { aPlanLimits, aUser } from '@/test/factories.ts';
import { tokens } from '@/lib/tokens.ts';
import type { UserResponse } from '@/api/types.ts';

vi.mock('@/api/billing.ts', () => ({ billingApi: { startTrial: vi.fn() } }));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const unverified = aUser({ id: 'u-vt', emailVerified: false, plan: 'FREE', trialStartedAt: null });
const verified = aUser({ id: 'u-vt', emailVerified: true, plan: 'FREE', trialStartedAt: null });

function renderCard(me: UserResponse, trialDays = 21) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, me);
  qc.setQueryData(PLAN_LIMITS_KEY, aPlanLimits({ trialDays }));
  return { qc, ...render(<QueryClientProvider client={qc}><VerifiedTrialCard /></QueryClientProvider>) };
}

const TITLE = 'Пошту підтверджено — увімкнути 21 день PRO?';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(tokens, 'hasAny').mockReturnValue(false);
  localStorage.removeItem('majstr.awaitingVerification.u-vt');
  localStorage.removeItem('majstr.verifiedTrialOfferSeen.u-vt');
});

describe('VerifiedTrialCard — «Пошту підтверджено — увімкнути N днів PRO?»', () => {
  it('offers the trial once the email this device saw unverified is verified, and starts it', async () => {
    noteVerificationState(unverified);
    const started = { ...verified, plan: 'PRO' as const, trialStartedAt: '2026-11-09T10:00:00Z' };
    vi.mocked(billingApi.startTrial).mockResolvedValue(started);
    const { qc } = renderCard(verified);

    fireEvent.click(screen.getByRole('button', { name: 'Увімкнути безкоштовно' }));

    await waitFor(() => expect(billingApi.startTrial).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    expect(qc.getQueryData(ME_QUERY_KEY)).toEqual(started);
  });

  it('«Пізніше» keeps it away on this device', () => {
    noteVerificationState(unverified);
    const { unmount } = renderCard(verified);
    fireEvent.click(screen.getByRole('button', { name: 'Пізніше' }));
    expect(screen.queryByText(TITLE)).toBeNull();
    unmount();

    renderCard(verified);
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('is not shown while unverified, after the trial, or to a master this device never saw unverified', () => {
    noteVerificationState(unverified);
    const { unmount } = renderCard(unverified);
    expect(screen.queryByText(TITLE)).toBeNull();
    unmount();

    const second = renderCard({ ...verified, trialStartedAt: '2026-10-01T00:00:00Z' });
    expect(screen.queryByText(TITLE)).toBeNull();
    second.unmount();

    localStorage.removeItem('majstr.awaitingVerification.u-vt');
    renderCard(verified);
    expect(screen.queryByText(TITLE)).toBeNull();
  });
});
