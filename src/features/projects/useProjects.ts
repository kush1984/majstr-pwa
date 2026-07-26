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
    void qc.invalidateQueries({ queryKey: PROJECTS_KEY });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
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

/**
 * Delete an object and everything under it. Offline-capable — and load-bearing for it: the
 * FREE cap tells a master who is over the limit to delete something, which was impossible to
 * act on without a signal. The backend delete is idempotent, so a replay can't block the queue.
 */
export function useDeleteProject() {
  const qc = useQueryClient();
  const invalidate = useInvalidateProjects();
  return useMutation({
    networkMode: 'always',
    mutationFn: (id: string) =>
      offlineMutate<void>({
        entity: 'project', entityId: id, type: 'delete', payload: {},
        deps: [],
        online: async () => { await projectsApi.remove(id); },
        onOnlineSuccess: invalidate,
        optimistic: () => {
          qc.setQueriesData<ProjectResponse[]>({ queryKey: [...PROJECTS_KEY, 'list'] }, (old) =>
            (old ?? []).filter((p) => p.id !== id));
          qc.removeQueries({ queryKey: [...PROJECTS_KEY, 'detail', id] });
        },
      }),
  });
}

/**
 * Change the object's status (planning → in progress → done). A separate outbox entity from
 * the field update: a queue can outlive an app update, so reshaping the existing `project`
 * update payload would break ops already sitting in a master's IndexedDB.
 */
export function useSetProjectStatus() {
  const qc = useQueryClient();
  const invalidate = useInvalidateProjects();
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ id, status }: { id: string; status: ProjectStatus }) =>
      offlineMutate<void>({
        entity: 'projectStatus', entityId: id, type: 'update', payload: { status },
        deps: [],
        online: async () => { await projectsApi.setStatus(id, status); },
        onOnlineSuccess: invalidate,
        optimistic: () => {
          qc.setQueriesData<ProjectResponse[]>({ queryKey: [...PROJECTS_KEY, 'list'] }, (old) =>
            (old ?? []).map((p) => (p.id === id ? { ...p, status } : p)));
          qc.setQueryData<ProjectResponse>([...PROJECTS_KEY, 'detail', id], (old) =>
            (old ? { ...old, status } : old));
        },
      }),
  });
}
