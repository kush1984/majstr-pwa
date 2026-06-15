import { api } from './client.ts';
import type { PlanLimits } from './types.ts';

/** Plan quotas for the current user (drives preemptive UI limit blocking). */
export const planApi = {
  limits(): Promise<PlanLimits> {
    return api.get<PlanLimits>('/api/plan/limits').then((r) => r.data);
  },
};
