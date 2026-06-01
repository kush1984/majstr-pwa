import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '@/api/dashboard.ts';

export function useDashboardMetrics() {
  return useQuery({
    queryKey: ['dashboard', 'metrics'],
    queryFn: () => dashboardApi.metrics(),
  });
}
