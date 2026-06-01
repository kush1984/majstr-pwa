import { api } from './client.ts';
import type { DashboardMetrics } from './types.ts';

/** Home-screen metrics — all counts/sums computed server-side. */
export const dashboardApi = {
  metrics(): Promise<DashboardMetrics> {
    return api.get<DashboardMetrics>('/api/dashboard/metrics').then((r) => r.data);
  },
};
