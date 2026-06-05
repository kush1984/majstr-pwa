import { api } from './client.ts';
import type { QuestionResponse } from './types.ts';

/**
 * Client questions left on the public portal, surfaced to the contractor
 * (Fix F #12). Backend contract (owner-only, 403 on someone else's project):
 *   GET   /api/projects/{projectId}/questions                  -> QuestionResponse[]
 *   PATCH /api/projects/{projectId}/questions/{questionId}/read -> 204
 * Marking read also decrements ProjectResponse.unreadQuestions.
 */
export const questionsApi = {
  listForProject(projectId: string): Promise<QuestionResponse[]> {
    return api
      .get<QuestionResponse[]>(`/api/projects/${projectId}/questions`)
      .then((r) => r.data);
  },

  markRead(projectId: string, questionId: string): Promise<void> {
    return api
      .patch(`/api/projects/${projectId}/questions/${questionId}/read`)
      .then(() => undefined);
  },
};
