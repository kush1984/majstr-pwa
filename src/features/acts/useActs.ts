import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { actsApi } from '@/api/acts.ts';
import { newUuid } from '@/lib/uuid.ts';
import type {
  WorkActCreateRequest,
  WorkActItemsRequest,
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

/** Create a draft act. A client UUID rides along so a retried create is idempotent. */
export function useCreateAct(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: WorkActCreateRequest) => actsApi.create(projectId, req, newUuid()),
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
