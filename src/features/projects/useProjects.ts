import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { projectsApi } from '@/api/projects.ts';
import type { ProjectRequest, ProjectStatus } from '@/api/types.ts';

export const PROJECTS_KEY = ['projects'] as const;

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

export function useCreateProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (req: ProjectRequest) => projectsApi.create(req),
    onSuccess: invalidate,
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: ProjectRequest }) => projectsApi.update(id, req),
    onSuccess: (_data, vars) => {
      invalidate();
      qc.invalidateQueries({ queryKey: [...PROJECTS_KEY, 'detail', vars.id] });
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
