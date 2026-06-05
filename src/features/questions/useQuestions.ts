import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { questionsApi } from '@/api/questions.ts';

export const questionsKey = (projectId: string) => ['project-questions', projectId] as const;

/** Client questions for one project (Fix F). */
export function useProjectQuestions(projectId: string, enabled = true) {
  return useQuery({
    queryKey: questionsKey(projectId),
    queryFn: () => questionsApi.listForProject(projectId),
    enabled: enabled && Boolean(projectId),
  });
}

/**
 * Mark questions read. Accepts a single id or a batch (e.g. all unread ones
 * when the contractor opens the project). Invalidates the project list so the
 * card "💬 N" indicator and the header bell counter update.
 */
export function useMarkQuestionsRead(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (questionIds: string[]) =>
      Promise.all(questionIds.map((qid) => questionsApi.markRead(projectId, qid))),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: questionsKey(projectId) });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}
