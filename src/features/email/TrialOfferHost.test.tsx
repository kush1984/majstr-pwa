import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { TrialOfferHost } from './TrialOfferHost.tsx';
import { trialOfferStore } from './trialOffer.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { PLAN_LIMITS_KEY } from '@/features/plan/usePlanLimits.ts';
import { authApi } from '@/api/auth.ts';
import { aPlanLimits, aUser } from '@/test/factories.ts';
import { tokens } from '@/lib/tokens.ts';
import { toast } from '@/hooks/useToast.ts';
import type { UserResponse } from '@/api/types.ts';

vi.mock('@/api/auth.ts', () => ({ authApi: { me: vi.fn(), resendVerification: vi.fn() } }));
// The real store, so a toast is really on screen; only the resend's own toasts are silenced.
vi.mock('@/hooks/useToast.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/hooks/useToast.ts')>();
  return { ...real, toast: { ...real.toast, success: vi.fn(), error: vi.fn() } };
});

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
}

/** Unverified, FREE, trial never taken: the master the card is for. */
const fresh = aUser({ id: 'u-trial', emailVerified: false, plan: 'FREE', trialStartedAt: null });

function renderHost(me: UserResponse, trialDays = 21) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, me);
  qc.setQueryData(PLAN_LIMITS_KEY, aPlanLimits({ trialDays }));
  return render(<QueryClientProvider client={qc}><TrialOfferHost /></QueryClientProvider>);
}

const send = () => act(() => { trialOfferStore.afterSend(); });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(tokens, 'hasAny').mockReturnValue(false); // the cache is the truth here
  localStorage.removeItem('majstr.trialOfferSeen.u-trial');
  trialOfferStore.clear();
  setVisibility('visible');
});

describe('TrialOfferHost — «Підтвердіть пошту — і зможете ввімкнути N днів PRO» after the first send', () => {
  it('names the server-configured trial length, and resends the letter', async () => {
    vi.mocked(authApi.resendVerification).mockResolvedValue(undefined);
    renderHost(fresh, 21);
    send();

    const dialog = await screen.findByRole('dialog', { name: 'Підтвердіть пошту — і зможете ввімкнути 21 день PRO' });
    expect(dialog).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати лист ще раз' }));
    await waitFor(() => expect(authApi.resendVerification).toHaveBeenCalled());
  });

  it('shows once: «Пізніше» keeps it away on the next send', async () => {
    const { unmount } = renderHost(fresh, 30);
    send();
    await screen.findByRole('dialog', { name: 'Підтвердіть пошту — і зможете ввімкнути 30 днів PRO' });
    fireEvent.click(screen.getByRole('button', { name: 'Пізніше' }));
    unmount();

    renderHost(fresh, 30);
    send();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is never shown to a verified master, nor to one who already took the trial', () => {
    const { unmount } = renderHost(aUser({ id: 'u-trial', emailVerified: true, plan: 'FREE', trialStartedAt: null }));
    send();
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();

    renderHost(aUser({ id: 'u-trial', emailVerified: false, plan: 'FREE', trialStartedAt: '2026-10-01T00:00:00Z' }));
    send();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('after «Поділитися» to Viber, waits for the master to come back to the app', async () => {
    renderHost(fresh, 21);
    setVisibility('hidden'); // the share target app is in front
    send();
    expect(screen.queryByRole('dialog')).toBeNull();

    setVisibility('visible');
    expect(await screen.findByRole('dialog', { name: 'Підтвердіть пошту — і зможете ввімкнути 21 день PRO' })).toBeTruthy();
  });

  it('after «Копіювати», does not wait for «Скопійовано» — toasts go to the top while a sheet is open', async () => {
    renderHost(fresh, 21);
    act(() => { toast.info('Посилання скопійовано', 0); });
    send();

    expect(await screen.findByRole('dialog', { name: 'Підтвердіть пошту — і зможете ввімкнути 21 день PRO' })).toBeTruthy();
  });

  it('stays closed until something is sent', () => {
    renderHost(fresh);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
