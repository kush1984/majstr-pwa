import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { actsApi } from '@/api/acts.ts';
import type {
  WorkActCreateRequest,
  WorkActItemsRequest,
  WorkActStatus,
  WorkActUpdateRequest,
} from '@/api/types.ts';

const actsKey = (projectId: string) => ['acts', projectId] as const;
const actKey = (id: string) => ['act', id] as const;
const progressKey = (projectId: string) => ['act-progress', projectId] as const;

export function useActs(projectId: string) {
  return useQuery({
    queryKey: actsKey(projectId),
    queryFn: () => actsApi.list(projectId),
    enabled: Boolean(projectId),
  });
}

export function useAct(id: string, enabled = true) {
  return useQuery({
    queryKey: actKey(id),
    queryFn: () => actsApi.get(id),
    enabled: enabled && Boolean(id),
  });
}

export function useActProgress(projectId: string, enabled = true) {
  return useQuery({
    queryKey: progressKey(projectId),
    queryFn: () => actsApi.progress(projectId),
    enabled: enabled && Boolean(projectId),
  });
}

/** Create a draft act. A client UUID rides along so a retried create is idempotent — generated
 *  ONCE per logical create (in mutate), never per attempt: a per-attempt UUID would defeat the
 *  X-Entity-Uuid replay the header exists for (review fix). */
export function useCreateAct(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ req, id }: { req: WorkActCreateRequest; id: string }) =>
      actsApi.create(projectId, req, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: actsKey(projectId) });
    },
  });
}

function useActWriter(id: string, projectId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: actKey(id) });
    void qc.invalidateQueries({ queryKey: actsKey(projectId) });
    void qc.invalidateQueries({ queryKey: progressKey(projectId) });
  };
}

export function useUpdateActHeader(id: string, projectId: string) {
  const invalidate = useActWriter(id, projectId);
  return useMutation({
    mutationFn: (req: WorkActUpdateRequest) => actsApi.updateHeader(id, req),
    onSuccess: invalidate,
  });
}

export function useReplaceActItems(id: string, projectId: string) {
  const invalidate = useActWriter(id, projectId);
  return useMutation({
    mutationFn: (req: WorkActItemsRequest) => actsApi.replaceItems(id, req),
    onSuccess: invalidate,
  });
}

/** Owner-side status move (recall / mark rejected / resurrect) — see actsApi.changeStatus. */
export function useChangeActStatus(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: WorkActStatus }) =>
      actsApi.changeStatus(id, status),
    onSuccess: (_act, { id }) => {
      void qc.invalidateQueries({ queryKey: actKey(id) });
      void qc.invalidateQueries({ queryKey: actsKey(projectId) });
      void qc.invalidateQueries({ queryKey: progressKey(projectId) });
    },
  });
}

export function useDeleteAct(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => actsApi.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: actsKey(projectId) });
      void qc.invalidateQueries({ queryKey: progressKey(projectId) });
    },
  });
}

export function useSignActOffline(id: string, projectId: string) {
  const invalidate = useActWriter(id, projectId);
  return useMutation({
    mutationFn: (signerName: string) => actsApi.signOffline(id, { signerName }),
    onSuccess: () => {
      invalidate();
    },
  });
}
