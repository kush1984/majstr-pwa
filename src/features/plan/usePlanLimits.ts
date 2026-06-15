import { useQuery } from '@tanstack/react-query';
import { planApi } from '@/api/plan.ts';
import { tokens } from '@/lib/tokens.ts';

export const PLAN_LIMITS_KEY = ['plan', 'limits'] as const;

/**
 * The current user's plan caps. Used to disable "create" buttons before the
 * user starts (prevention, not reject-at-the-end). Plan changes are admin-manual
 * so a 5-minute staleTime is plenty; the cache is cleared on login.
 */
export function usePlanLimits() {
  return useQuery({
    queryKey: PLAN_LIMITS_KEY,
    queryFn: planApi.limits,
    enabled: tokens.hasAny(),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * True when a resource count has reached its plan cap. A `null`/`undefined` max
 * means unlimited (PRO/TEAM, or limits not loaded yet) → never blocked, so the
 * UI fails open and the backend stays the real guard.
 */
export function isAtLimit(count: number, max: number | null | undefined): boolean {
  return max != null && count >= max;
}
