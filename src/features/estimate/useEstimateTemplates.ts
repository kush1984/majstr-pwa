import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { estimateTemplatesApi } from '@/api/estimateTemplates.ts';
import type { EstimateCreateRequest, EstimateTemplateDetail, TemplateItemRequest } from '@/api/types.ts';

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
    mutationFn: (name: string) => estimateTemplatesApi.saveFromEstimate(estimateId, { name }),
    onSuccess: invalidate,
  });
}

export function useRenameTemplate() {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      estimateTemplatesApi.rename(id, { name }),
    onSuccess: invalidate,
  });
}

export function useDeleteTemplate() {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: (id: string) => estimateTemplatesApi.remove(id),
    onSuccess: invalidate,
  });
}

/** Add a position to my own template. Returns the updated detail; we prime the
 *  detail cache and refresh the list (item counts changed). */
export function useAddTemplateItem(templateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: TemplateItemRequest) => estimateTemplatesApi.addItem(templateId, req),
    onSuccess: (detail: EstimateTemplateDetail) => {
      qc.setQueryData([...ESTIMATE_TEMPLATE_KEY, templateId], detail);
      qc.invalidateQueries({ queryKey: ESTIMATE_TEMPLATE_KEY });
    },
  });
}

/** Remove a position from my own template. */
export function useRemoveTemplateItem(templateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => estimateTemplatesApi.removeItem(templateId, itemId),
    onSuccess: (detail: EstimateTemplateDetail) => {
      qc.setQueryData([...ESTIMATE_TEMPLATE_KEY, templateId], detail);
      qc.invalidateQueries({ queryKey: ESTIMATE_TEMPLATE_KEY });
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
