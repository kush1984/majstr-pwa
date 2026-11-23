import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appReviewsApi } from '@/api/appReviews.ts';
import type { AppReviewRequest } from '@/api/types.ts';

export const APP_REVIEW_PROMPT_KEY = ['app-review-prompt'] as const;

/** Should the home screen ask him to rate Majstr now — the server decides (V218). */
export function useAppReviewPrompt(enabled = true) {
  return useQuery({
    queryKey: APP_REVIEW_PROMPT_KEY,
    queryFn: () => appReviewsApi.prompt(),
    enabled,
    // Asked once per visit is plenty; the answer changes only when he answers.
    staleTime: Infinity,
    retry: false,
  });
}

/** Rating sent or «Не зараз»: the home screen stops asking at once, without a refetch. */
function useSettlePrompt() {
  const qc = useQueryClient();
  return () => qc.setQueryData(APP_REVIEW_PROMPT_KEY, { ask: false });
}

export function useSubmitAppReview() {
  const settle = useSettlePrompt();
  return useMutation({
    mutationFn: (req: AppReviewRequest) => appReviewsApi.submit(req),
    onSuccess: settle,
  });
}

export function useDismissAppReviewPrompt() {
  const settle = useSettlePrompt();
  return useMutation({
    mutationFn: () => appReviewsApi.dismissPrompt(),
    onMutate: settle,
  });
}
