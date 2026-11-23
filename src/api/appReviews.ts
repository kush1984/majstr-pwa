import { api } from './client.ts';
import type { AppReviewRequest, PublicAppReview } from './types.ts';

/**
 * Masters rate Majstr itself (V218).
 *   GET  /api/app-reviews/prompt          -> { ask } — should the home screen ask now
 *   POST /api/app-reviews/prompt/dismiss  -> 204, «Не зараз»
 *   POST /api/app-reviews                 -> 204
 *   GET  /api/public/app-reviews          -> what majstr.pro shows (no login)
 */
export const appReviewsApi = {
  prompt(): Promise<{ ask: boolean }> {
    return api.get<{ ask: boolean }>('/api/app-reviews/prompt').then((r) => r.data);
  },
  dismissPrompt(): Promise<void> {
    return api.post('/api/app-reviews/prompt/dismiss').then(() => undefined);
  },
  submit(req: AppReviewRequest): Promise<void> {
    return api.post('/api/app-reviews', req).then(() => undefined);
  },
  published(): Promise<PublicAppReview[]> {
    return api.get<PublicAppReview[]>('/api/public/app-reviews').then((r) => r.data);
  },
};
