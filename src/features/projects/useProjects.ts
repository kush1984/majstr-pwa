import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { projectsApi } from '@/api/projects.ts';
import { newUuid } from '@/lib/uuid.ts';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import { CLIENTS_KEY } from '@/features/clients/useClients.ts';
import type { ClientResponse, ProjectRequest, ProjectResponse, ProjectStatus } from '@/api/types.ts';

export const PROJECTS_KEY = ['projects'] as const;

/** The client's display name, from the clients cache — so an offline card shows it before syncing. */
function clientName(qc: QueryClient, clientId?: string): string | null {
  if (!clientId) return null;
  const list = qc.getQueryData<ClientResponse[]>([...CLIENTS_KEY, 'list']);
  return list?.find((c) => c.id === clientId)?.fullName ?? null;
}

export function useProjects(status?: ProjectStatus) {
  return useQuery({
    queryKey: [...PROJECTS_KEY, 'list', status ?? 'all'],
    queryFn: () => projectsApi.list(status),
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: [...PROJECTS_KEY, 'detail', id],
    queryFn: () => projectsApi.get(id),
    enabled: Boolean(id),
  });
}

function useInvalidateProjects() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: PROJECTS_KEY });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

/**
 * Create a project — offline-first. A client-generated UUID lets the object open instantly and the
 * create ride the outbox (idempotent on the backend via the id header). If the object references a
 * client that was ALSO created offline, the op depends on that client's op, so the client syncs
 * first (an estimate/object never lands referencing a client the server doesn't have yet). The FREE
 * object cap is enforced client-side before we get here (`isAtLimit`, off the cached count) — that
 * gate works offline too, which is why over-limit rarely reaches sync.
 */
export function useCreateProject() {
  const qc = useQueryClient();
  const invalidate = useInvalidateProjects();
  return useMutation({
    networkMode: 'always', // run while offline so offlineMutate can queue instead of pausing
    mutationFn: (req: ProjectRequest): Promise<ProjectResponse> => {
      const id = newUuid();
      const now = new Date().toISOString();
      const optimistic: ProjectResponse = {
        id, name: req.name, address: req.address, status: 'DRAFT',
        description: req.description ?? null,
        clientId: req.clientId ?? null,
        clientFullName: clientName(qc, req.clientId),
        latestEstimateTotal: null, estimateStatus: null, unreadQuestions: 0,
        completedAt: null, createdAt: now, updatedAt: now,
      };
      return offlineMutate<ProjectResponse>({
        entity: 'project', entityId: id, type: 'create', payload: req,
        deps: req.clientId ? [req.clientId] : [],
        online: () => projectsApi.create(req, id),
        onOnlineSuccess: invalidate,
        optimistic: () => {
          qc.setQueryData<ProjectResponse[]>([...PROJECTS_KEY, 'list', 'all'], (old) => [optimistic, ...(old ?? [])]);
          qc.setQueryData<ProjectResponse>([...PROJECTS_KEY, 'detail', id], optimistic);
          return optimistic;
        },
      });
    },
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  const invalidate = useInvalidateProjects();
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ id, req }: { id: string; req: ProjectRequest }): Promise<void> => {
      const patch = (p: ProjectResponse): ProjectResponse => ({
        ...p, name: req.name, address: req.address, description: req.description ?? null,
        clientId: req.clientId ?? null, clientFullName: clientName(qc, req.clientId),
      });
      return offlineMutate<void>({
        entity: 'project', entityId: id, type: 'update', payload: req,
        deps: req.clientId ? [req.clientId] : [],
        online: async () => { await projectsApi.update(id, req); },
        onOnlineSuccess: () => {
          invalidate();
          void qc.invalidateQueries({ queryKey: [...PROJECTS_KEY, 'detail', id] });
        },
        optimistic: () => {
          qc.setQueriesData<ProjectResponse[]>({ queryKey: [...PROJECTS_KEY, 'list'] }, (old) =>
            (old ?? []).map((p) => (p.id === id ? patch(p) : p)));
          qc.setQueryData<ProjectResponse>([...PROJECTS_KEY, 'detail', id], (old) => (old ? patch(old) : old));
        },
      });
    },
  });
}

export function useDeleteProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (id: string) => projectsApi.remove(id),
    onSuccess: invalidate,
  });
}

export function useSetProjectStatus() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ProjectStatus }) =>
      projectsApi.setStatus(id, status),
    onSuccess: invalidate,
  });
}
