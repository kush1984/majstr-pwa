import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { actsApi } from '@/api/acts.ts';
import { CLIENT_DRIVEN_QUERY } from '@/lib/clientDrivenQuery.ts';
import type {
  WorkActCreateRequest,
  WorkActItemsRequest,
  WorkActReceiptRequest,
  WorkActStatus,
  WorkActUpdateRequest,
} from '@/api/types.ts';

const actsKey = (projectId: string) => ['acts', projectId] as const;
/** Exported for the receipt batch, which READS the act back mid-run to see the master's edits. */
export const actKey = (id: string) => ['act', id] as const;
const progressKey = (projectId: string) => ['act-progress', projectId] as const;

export function useActs(projectId: string) {
  return useQuery({
    ...CLIENT_DRIVEN_QUERY,
    queryKey: actsKey(projectId),
    queryFn: () => actsApi.list(projectId),
    enabled: Boolean(projectId),
  });
}

/**
 * One act. CLIENT-DRIVEN, like the list: the client signs it in HIS browser, on his own phone, and
 * nothing in the master's session fires (review P-38). The master switched back to a tab that
 * still said DRAFT and went on typing into a document that had been accepted.
 */
export function useAct(id: string, enabled = true) {
  return useQuery({
    ...CLIENT_DRIVEN_QUERY,
    queryKey: actKey(id),
    queryFn: () => actsApi.get(id),
    enabled: enabled && Boolean(id),
  });
}

/** Also client-driven: a signature moves «виконано раніше» on every position the act closed. */
export function useActProgress(projectId: string, enabled = true) {
  return useQuery({
    ...CLIENT_DRIVEN_QUERY,
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

/** Invalidate everything one act write touches, with the act id passed at call time — the new-act
 *  editor only learns it after its create call returns. */
export function useActsInvalidator(projectId: string) {
  const qc = useQueryClient();
  return (id: string) => {
    void qc.invalidateQueries({ queryKey: actKey(id) });
    void qc.invalidateQueries({ queryKey: actsKey(projectId) });
    void qc.invalidateQueries({ queryKey: progressKey(projectId) });
  };
}

/** Invalidate everything one act write touches. Exported so the receipt batch, which drives
 *  actsApi directly to keep per-file control, refreshes exactly what the mutations do. */
export function useActWriter(id: string, projectId: string) {
  const invalidate = useActsInvalidator(projectId);
  return () => invalidate(id);
}

/**
 * Both act writes answer with the WHOLE act, and both put that answer straight into the cache
 * before the refetch lands (review P-31).
 *
 * <p>The editor shows the SERVER's totals once the form is clean (P-34), so the gap between «the
 * save returned» and «the refetch landed» was a window where it showed the previous figures under
 * a form that had just been saved — and the receipt batch, which reads the same cache to decide
 * what the master has already answered, read them too.</p>
 */
export function useUpdateActHeader(id: string, projectId: string) {
  const qc = useQueryClient();
  const invalidate = useActWriter(id, projectId);
  return useMutation({
    mutationFn: (req: WorkActUpdateRequest) => actsApi.updateHeader(id, req),
    onSuccess: (saved) => {
      qc.setQueryData(actKey(id), saved);
      invalidate();
    },
  });
}

export function useReplaceActItems(id: string, projectId: string) {
  const qc = useQueryClient();
  const invalidate = useActWriter(id, projectId);
  return useMutation({
    mutationFn: (req: WorkActItemsRequest) => actsApi.replaceItems(id, req),
    onSuccess: (saved) => {
      qc.setQueryData(actKey(id), saved);
      invalidate();
    },
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

export function useUpdateActReceipt(id: string, projectId: string) {
  const invalidate = useActWriter(id, projectId);
  return useMutation({
    mutationFn: ({ receiptId, req }: { receiptId: string; req: WorkActReceiptRequest }) =>
      actsApi.updateReceipt(id, receiptId, req),
    onSuccess: invalidate,
  });
}

export function useDeleteActReceipt(id: string, projectId: string) {
  const invalidate = useActWriter(id, projectId);
  return useMutation({
    mutationFn: (receiptId: string) => actsApi.removeReceipt(id, receiptId),
    onSuccess: invalidate,
  });
}
