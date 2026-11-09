import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { useStartTrial } from './useStartTrial.ts';
import { usePlanLimits } from './usePlanLimits.ts';
import { billingApi } from '@/api/billing.ts';
import { planApi } from '@/api/plan.ts';
import { tokens } from '@/lib/tokens.ts';
import { aPlanLimits, aUser } from '@/test/factories.ts';

vi.mock('@/api/billing.ts', () => ({ billingApi: { startTrial: vi.fn() } }));
vi.mock('@/api/plan.ts', () => ({ planApi: { limits: vi.fn() } }));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(tokens, 'hasAny').mockReturnValue(true);
});

describe('useStartTrial', () => {
  it('re-asks the plan limits once the trial is on — the FREE caps must not outlive the plan', async () => {
    const free = aPlanLimits({ maxProjects: 2 });
    const pro = aPlanLimits({ plan: 'PRO', maxProjects: null });
    vi.mocked(planApi.limits).mockResolvedValueOnce(free).mockResolvedValueOnce(pro);
    vi.mocked(billingApi.startTrial).mockResolvedValue(
      aUser({ plan: 'PRO', trialStartedAt: '2026-11-09T10:00:00Z', planExpiresAt: '2026-11-30T10:00:00Z' }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => ({ limits: usePlanLimits(), trial: useStartTrial() }), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => expect(result.current.limits.data).toEqual(free));

    await act(async () => {
      expect(await result.current.trial.start()).toBe(true);
    });

    await waitFor(() => expect(result.current.limits.data).toEqual(pro));
    expect(planApi.limits).toHaveBeenCalledTimes(2);
  });

  it('leaves the limits alone when the trial is refused', async () => {
    vi.mocked(planApi.limits).mockResolvedValue(aPlanLimits());
    vi.mocked(billingApi.startTrial).mockRejectedValue(new Error('nope'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => ({ limits: usePlanLimits(), trial: useStartTrial() }), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => expect(result.current.limits.isSuccess).toBe(true));

    await act(async () => {
      expect(await result.current.trial.start()).toBe(false);
    });

    expect(planApi.limits).toHaveBeenCalledTimes(1);
  });
});
