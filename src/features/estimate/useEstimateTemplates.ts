import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { estimateTemplatesApi } from '@/api/estimateTemplates.ts';
import type {
  EstimateCreateRequest,
  EstimateTemplateDetail,
  EstimateTemplateSummary,
  TemplateItemRequest,
  Trade,
} from '@/api/types.ts';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import { newUuid } from '@/lib/uuid.ts';

export const ESTIMATE_TEMPLATE_KEY = ['estimate-templates'] as const;

/** Defaults relevant to my trades (+ general) plus my own templates. */
export function useEstimateTemplates() {
  return useQuery({
    queryKey: ESTIMATE_TEMPLATE_KEY,
    queryFn: () => estimateTemplatesApi.list(),
  });
}

/** A template's composition (its positions) — for the preview. Lazy: only
 *  fetched once a template is opened. */
export function useEstimateTemplate(id: string | null) {
  return useQuery({
    queryKey: [...ESTIMATE_TEMPLATE_KEY, id],
    queryFn: () => estimateTemplatesApi.get(id as string),
    enabled: Boolean(id),
  });
}

function useInvalidateTemplates() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ESTIMATE_TEMPLATE_KEY });
}

/** Save the current estimate as my own reusable template. */
export function useSaveAsTemplate(estimateId: string) {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: (req: { name: string; trade: Trade | null }) =>
      estimateTemplatesApi.saveFromEstimate(estimateId, req),
    onSuccess: invalidate,
  });
}

/** Patch one template's row in the cached list (no-op when the list isn't cached yet). */
function patchSummary(
  qc: QueryClient,
  id: string,
  edit: (t: EstimateTemplateSummary) => EstimateTemplateSummary,
): void {
  qc.setQueryData<EstimateTemplateSummary[]>(ESTIMATE_TEMPLATE_KEY, (old) =>
    old?.map((t) => (t.id === id ? edit(t) : t)));
}

function patchDetail(
  qc: QueryClient,
  id: string,
  edit: (d: EstimateTemplateDetail) => EstimateTemplateDetail,
): EstimateTemplateDetail | undefined {
  const key = [...ESTIMATE_TEMPLATE_KEY, id];
  const next = qc.getQueryData<EstimateTemplateDetail>(key);
  if (!next) return undefined;
  const patched = edit(next);
  qc.setQueryData(key, patched);
  return patched;
}

/**
 * Template editing is offline-first: the master reworks their own templates between objects,
 * often with no signal. `saveAsTemplate` / `applyTemplate` stay online — they read or write
 * server-side state (an estimate's items, a new estimate) we can't reproduce locally.
 */

/** Re-file a template into another trade (master's own setting). */
export function useSetTemplateTrade() {
  const qc = useQueryClient();
  const invalidate = useInvalidateTemplates();
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ id, trade }: { id: string; trade: Trade | null }): Promise<void> =>
      offlineMutate<void>({
        entity: 'estimateTemplate', entityId: id, type: 'update', payload: { op: 'trade', trade }, deps: [],
        online: async () => { await estimateTemplatesApi.setTrade(id, { trade }); },
        onOnlineSuccess: invalidate,
        optimistic: () => {
          patchSummary(qc, id, (t) => ({ ...t, trade }));
          patchDetail(qc, id, (d) => ({ ...d, trade }));
        },
      }),
  });
}

export function useRenameTemplate() {
  const qc = useQueryClient();
  const invalidate = useInvalidateTemplates();
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ id, name }: { id: string; name: string }): Promise<void> =>
      offlineMutate<void>({
        entity: 'estimateTemplate', entityId: id, type: 'update', payload: { op: 'rename', name }, deps: [],
        online: async () => { await estimateTemplatesApi.rename(id, { name }); },
        onOnlineSuccess: invalidate,
        optimistic: () => {
          patchSummary(qc, id, (t) => ({ ...t, name }));
          patchDetail(qc, id, (d) => ({ ...d, name }));
        },
      }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  const invalidate = useInvalidateTemplates();
  return useMutation({
    networkMode: 'always',
    mutationFn: (id: string): Promise<void> =>
      offlineMutate<void>({
        entity: 'estimateTemplate', entityId: id, type: 'delete', payload: {}, deps: [],
        online: async () => { await estimateTemplatesApi.remove(id); },
        onOnlineSuccess: invalidate,
        optimistic: () => {
          qc.setQueryData<EstimateTemplateSummary[]>(ESTIMATE_TEMPLATE_KEY, (old) =>
            old?.filter((t) => t.id !== id));
          qc.removeQueries({ queryKey: [...ESTIMATE_TEMPLATE_KEY, id] });
        },
      }),
  });
}

/** Add a position to my own template. Returns the updated detail; we prime the
 *  detail cache and refresh the list (item counts changed). */
export function useAddTemplateItem(templateId: string) {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: (req: TemplateItemRequest): Promise<EstimateTemplateDetail | undefined> => {
      const id = newUuid();
      return offlineMutate<EstimateTemplateDetail | undefined>({
        entity: 'templateItem', entityId: id, type: 'create',
        payload: { templateId, req }, deps: [templateId],
        online: () => estimateTemplatesApi.addItem(templateId, req, id),
        onOnlineSuccess: () => qc.invalidateQueries({ queryKey: ESTIMATE_TEMPLATE_KEY }),
        optimistic: () => {
          patchSummary(qc, templateId, (t) => ({ ...t, itemCount: t.itemCount + 1 }));
          return patchDetail(qc, templateId, (d) => ({
            ...d,
            items: [...d.items, {
              id, name: req.name, type: req.type, unit: req.unit,
              sortOrder: d.items.length ? d.items[d.items.length - 1].sortOrder + 1 : 0,
            }],
          }));
        },
      });
    },
    onSuccess: (detail) => {
      if (detail) qc.setQueryData([...ESTIMATE_TEMPLATE_KEY, templateId], detail);
    },
  });
}

/** Remove a position from my own template. */
export function useRemoveTemplateItem(templateId: string) {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: (itemId: string): Promise<EstimateTemplateDetail | undefined> =>
      offlineMutate<EstimateTemplateDetail | undefined>({
        entity: 'templateItem', entityId: itemId, type: 'delete',
        payload: { templateId }, deps: [templateId],
        online: () => estimateTemplatesApi.removeItem(templateId, itemId),
        onOnlineSuccess: () => qc.invalidateQueries({ queryKey: ESTIMATE_TEMPLATE_KEY }),
        optimistic: () => {
          patchSummary(qc, templateId, (t) => ({ ...t, itemCount: Math.max(0, t.itemCount - 1) }));
          return patchDetail(qc, templateId, (d) => ({
            ...d, items: d.items.filter((i) => i.id !== itemId),
          }));
        },
      }),
    onSuccess: (detail) => {
      if (detail) qc.setQueryData([...ESTIMATE_TEMPLATE_KEY, templateId], detail);
    },
  });
}

/** Apply a template → a new estimate in the project. Invalidates the project's
 *  estimate list / cards (a new estimate appeared). */
export function useApplyTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { projectId: string; templateId: string; req: EstimateCreateRequest }) =>
      estimateTemplatesApi.applyToProject(args.projectId, args.templateId, args.req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
