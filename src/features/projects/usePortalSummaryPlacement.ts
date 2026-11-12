import { useMutation, useQueryClient } from '@tanstack/react-query';
import { portalApi } from '@/api/portal.ts';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import type { PortalSummaryRequest, ProjectResponse } from '@/api/types.ts';
import { PROJECTS_KEY } from './useProjects.ts';

export const PORTAL_SUMMARY_ENTITY = 'portalSummary';

/**
 * Where the client's page shows «Зведення» (V202) — the object's choice, so every link it has sent
 * follows it. The whole state in one op, so a newer tick replaces a queued one (`coalesce`).
 */
export function usePortalSummaryPlacement(projectId: string) {
  const qc = useQueryClient();
  const patch = (atBottom: boolean) => {
    const set = (p: ProjectResponse): ProjectResponse => ({ ...p, portalSummaryAtBottom: atBottom });
    qc.setQueriesData<ProjectResponse[]>({ queryKey: [...PROJECTS_KEY, 'list'] }, (old) =>
      old?.map((p) => (p.id === projectId ? set(p) : p)));
    qc.setQueryData<ProjectResponse>([...PROJECTS_KEY, 'detail', projectId], (old) => (old ? set(old) : old));
  };
  return useMutation({
    networkMode: 'always',
    mutationFn: (atBottom: boolean): Promise<void> => {
      const req: PortalSummaryRequest = { atBottom };
      return offlineMutate<void>({
        entity: 'portalSummary', entityId: projectId, type: 'update', coalesce: true,
        payload: { req }, deps: [projectId],
        online: async () => { await portalApi.setSummaryAtBottom(projectId, req); },
        cancel: () => qc.cancelQueries({ queryKey: PROJECTS_KEY }),
        onOnlineSuccess: () => patch(atBottom),
        optimistic: () => patch(atBottom),
      });
    },
  });
}
