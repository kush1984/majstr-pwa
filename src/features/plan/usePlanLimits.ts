import { useQuery } from '@tanstack/react-query';
import { planApi } from '@/api/plan.ts';
import { tokens } from '@/lib/tokens.ts';
import type { PlanLimits } from '@/api/types.ts';

export const PLAN_LIMITS_KEY = ['plan', 'limits'] as const;

/**
 * The current user's plan caps. Used to disable "create" buttons before the
 * user starts (prevention, not reject-at-the-end). A plan changes rarely, so a
 * 5-minute staleTime is plenty; the cache is cleared on login and invalidated by
 * `useStartTrial`.
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

/**
 * At the FREE object cap with no bought one-off object left to spend (V214). A credit lets the next
 * create through — the server spends it and marks that object paid.
 */
export function isAtObjectLimit(limits: PlanLimits | undefined): boolean {
  return isAtLimit(limits?.projectsUsed ?? 0, limits?.maxProjects) && (limits?.objectCredits ?? 0) <= 0;
}

/** The per-object caps on this object: PRO's on a one-off paid object (V214), else the plan's. */
export function objectCaps(limits: PlanLimits | undefined, paid: boolean | undefined) {
  const plan = {
    maxEstimatesPerProject: limits?.maxEstimatesPerProject,
    maxPhotosPerObject: limits?.maxPhotosPerObject,
    maxReceiptPhotosPerObject: limits?.maxReceiptPhotosPerObject,
  };
  if (!paid || !limits?.paidObject) return plan;
  // Never tighter than the plan's: a paid object on PRO stays on PRO's caps.
  const looser = (a: number | null | undefined, b: number | null) =>
    a == null || b == null ? null : Math.max(a, b);
  return {
    maxEstimatesPerProject: looser(plan.maxEstimatesPerProject, limits.paidObject.maxEstimatesPerProject),
    maxPhotosPerObject: looser(plan.maxPhotosPerObject, limits.paidObject.maxPhotosPerObject),
    maxReceiptPhotosPerObject: looser(plan.maxReceiptPhotosPerObject, limits.paidObject.maxReceiptPhotosPerObject),
  };
}
