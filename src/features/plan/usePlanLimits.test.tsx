import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isAtLimit, isAtObjectLimit, objectCaps, usePlanLimits } from './usePlanLimits.ts';
import { planApi } from '@/api/plan.ts';
import { tokens } from '@/lib/tokens.ts';
import type { PlanLimits } from '@/api/types.ts';
import { aPlanLimits } from '@/test/factories.ts';

vi.mock('@/api/plan.ts', () => ({ planApi: { limits: vi.fn() } }));

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('isAtObjectLimit (V214)', () => {
  it('blocks at the cap with no bought object', () => {
    expect(isAtObjectLimit(aPlanLimits({ maxProjects: 2, projectsUsed: 2 }))).toBe(true);
  });

  it('lets a bought object through at the cap', () => {
    expect(isAtObjectLimit(aPlanLimits({ maxProjects: 2, projectsUsed: 2, objectCredits: 1 }))).toBe(false);
  });

  it('fails open while limits are loading', () => {
    expect(isAtObjectLimit(undefined)).toBe(false);
  });
});

describe('objectCaps (V214)', () => {
  const limits = aPlanLimits({
    maxEstimatesPerProject: 3,
    maxPhotosPerObject: 5,
    maxReceiptPhotosPerObject: 5,
    paidObject: { maxEstimatesPerProject: null, maxPhotosPerObject: 50, maxReceiptPhotosPerObject: 50 },
  });

  it("keeps the plan's caps on an ordinary object", () => {
    expect(objectCaps(limits, false)).toEqual({
      maxEstimatesPerProject: 3, maxPhotosPerObject: 5, maxReceiptPhotosPerObject: 5,
    });
  });

  it("takes PRO's caps on a paid object", () => {
    expect(objectCaps(limits, true)).toEqual({
      maxEstimatesPerProject: null, maxPhotosPerObject: 50, maxReceiptPhotosPerObject: 50,
    });
  });
});

describe('isAtLimit', () => {
  it('blocks at or above the cap', () => {
    expect(isAtLimit(2, 2)).toBe(true);
    expect(isAtLimit(4, 3)).toBe(true);
  });

  it('allows below the cap', () => {
    expect(isAtLimit(1, 2)).toBe(false);
    expect(isAtLimit(0, 3)).toBe(false);
  });

  it('treats null/undefined (unlimited or not loaded yet) as NOT blocked', () => {
    // fails open — the backend stays the real guard
    expect(isAtLimit(99, null)).toBe(false);
    expect(isAtLimit(99, undefined)).toBe(false);
  });
});

describe('usePlanLimits', () => {
  const free: PlanLimits = aPlanLimits({ maxProjects: 2, maxEstimatesPerProject: 3 });

  it('fetches the plan limits when logged in', async () => {
    tokens.set('access', 'refresh');
    vi.mocked(planApi.limits).mockResolvedValue(free);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => usePlanLimits(), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.data).toEqual(free));
    expect(planApi.limits).toHaveBeenCalledOnce();
  });

  it('does not fetch when logged out (no token)', () => {
    vi.mocked(planApi.limits).mockResolvedValue(free);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderHook(() => usePlanLimits(), { wrapper: wrapper(qc) });

    expect(planApi.limits).not.toHaveBeenCalled();
  });
});
