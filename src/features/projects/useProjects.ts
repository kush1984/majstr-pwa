import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { projectsApi } from '@/api/projects.ts';
import { newUuid } from '@/lib/uuid.ts';
import { track } from '@/lib/posthog.ts';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { CLIENTS_KEY } from '@/features/clients/useClients.ts';
import type { ClientResponse, ObjectStage, ProjectRequest, ProjectResponse, ProjectStatus } from '@/api/types.ts';

export const PROJECTS_KEY = ['projects'] as const;

/** The client's display name, from the clients cache — so an offline card shows it before syncing. */
function clientName(qc: QueryClient, clientId?: string): string | null {
  if (!clientId) return null;
  const list = qc.getQueryData<ClientResponse[]>([...CLIENTS_KEY, 'list']);
  return list?.find((c) => c.id === clientId)?.fullName ?? null;
}

export function useProjects(stage?: ObjectStage) {
  return useQuery({
    queryKey: [...PROJECTS_KEY, 'list', stage ?? 'all'],
    queryFn: () => projectsApi.list(stage),
    // Overrides the global `false`. This list carries `unreadQuestions`, which feeds the header bell
    // and the row badges — the one thing that changes while the master is NOT looking at the app.
    // Without this, a message that arrived as a push stayed invisible until a manual refresh.
    refetchOnWindowFocus: true,
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
        id, name: req.name, address: req.address, status: 'DRAFT', stage: 'ASSESSMENT',
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
          // Fired here, not in `online`: the object exists for the master the moment the
          // optimistic row lands, and an object authored in a basement must count the same as
          // one authored on wifi (the capture itself is queued by the SDK, never a request now).
          track('project_created', { hasClient: req.clientId != null });
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
 * Best-effort optimistic {@link ObjectStage} for a `PATCH .../status` write, mirroring the
 * backend's `ObjectStage.derive` priority (object-status-unification). CANCELLED and COMPLETED are
 * always exactly right here — they're top priority regardless of estimates. The fallback ("back to
 * active" — Повернути в роботу / Відновити, both send `IN_PROGRESS`) can't be derived precisely
 * client-side: the cache only carries the LATEST estimate's status, not "has any estimate ever been
 * SIGNED", so it's a reasonable guess from that field, corrected a moment later by the real refetch
 * (`onOnlineSuccess: invalidate` below) — never the value actually shown to rest on.
 */
export function resolveOptimisticStage(current: ProjectResponse, newStatus: ProjectStatus): ObjectStage {
  if (newStatus === 'CANCELLED') return 'CANCELLED';
  if (newStatus === 'COMPLETED') return 'COMPLETED';
  if (current.estimateStatus === 'SIGNED') return 'IN_PROGRESS';
  if (current.estimateStatus === 'SENT') return 'PENDING_SIGNATURE';
  return 'ASSESSMENT';
}

/**
 * Change the object's status (planning → in progress → done). A separate outbox entity from
 * the field update: a queue can outlive an app update, so reshaping the existing `project`
 * update payload would break ops already sitting in a master's IndexedDB.
 *
 * Reused as-is for the manual complete/reopen/cancel/restore actions (object-status-unification) —
 * no new endpoints, so any op already queued offline from before this iteration keeps replaying
 * correctly. The optimistic patch also updates `completedAt` (mirrors the backend's
 * `applyCompletedAt`: stamped entering COMPLETED, cleared leaving it) and `stage`
 * ({@link resolveOptimisticStage}).
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
          const patch = (p: ProjectResponse): ProjectResponse => ({
            ...p,
            status,
            stage: resolveOptimisticStage(p, status),
            completedAt: status === 'COMPLETED' ? (p.completedAt ?? new Date().toISOString()) : null,
          });
          qc.setQueriesData<ProjectResponse[]>({ queryKey: [...PROJECTS_KEY, 'list'] }, (old) =>
            (old ?? []).map((p) => (p.id === id ? patch(p) : p)));
          qc.setQueryData<ProjectResponse>([...PROJECTS_KEY, 'detail', id], (old) =>
            (old ? patch(old) : old));
        },
      }),
  });
}

export type ObjectAction = 'complete' | 'reopen' | 'cancel' | 'restore';

/** The four manual object transitions all reuse the SAME PATCH .../status endpoint — see
 *  {@link useSetProjectStatus}'s own doc comment for why this wasn't split into new endpoints. */
const OBJECT_ACTION_STATUS: Record<ObjectAction, ProjectStatus> = {
  complete: 'COMPLETED', reopen: 'IN_PROGRESS', cancel: 'CANCELLED', restore: 'IN_PROGRESS',
};

/** COMPLETED/CANCELLED are dead ends with exactly one way out (reopen/restore) — no sharing, no
 *  cancelling a completed object, no completing a cancelled one. Everything status- or
 *  sharing-related that only makes sense on a live object gates on this. */
export function isTerminalStage(stage: ObjectStage): boolean {
  return stage === 'COMPLETED' || stage === 'CANCELLED';
}

/**
 * "Завершити/Скасувати об'єкт" etc — the confirm-then-mutate flow in one place, because it is
 * offered from two spots: the object's own hero menu, and every row of the object list (so a
 * master doesn't have to open an object just to close it out).
 */
export function useObjectStatusAction(projectId: string) {
  const setProjectStatus = useSetProjectStatus();
  const [objectAction, setObjectAction] = useState<ObjectAction | null>(null);

  const confirm = () => {
    if (!objectAction) return;
    setProjectStatus.mutate(
      { id: projectId, status: OBJECT_ACTION_STATUS[objectAction] },
      {
        onError: (err) => toast.error(toAppError(err).message),
        onSettled: () => setObjectAction(null),
      },
    );
  };

  return { objectAction, chooseAction: setObjectAction, confirm, isPending: setProjectStatus.isPending };
}
