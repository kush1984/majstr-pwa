import { useQuery } from '@tanstack/react-query';
import { authApi } from '@/api/auth.ts';
import { tokens } from '@/lib/tokens.ts';
import type { UserResponse } from '@/api/types.ts';

export const ME_QUERY_KEY = ['me'] as const;

/**
 * Source of truth for "am I logged in?". Runs only when we have a
 * token in storage; if it returns successfully the user is valid
 * (the refresh interceptor handled any expired access token along
 * the way).
 */
export function useMe() {
  return useQuery<UserResponse>({
    queryKey: ME_QUERY_KEY,
    queryFn: authApi.me,
    enabled: tokens.hasAny(),
    staleTime: 5 * 60 * 1000, // 5 min — re-fetched on focus / mutation
    // Uses the global retry policy: transient failures (network/5xx) retry
    // with backoff so a blip at boot doesn't dump the user on an error
    // screen; 401 is never retried by policy (the interceptor already
    // chased it through refresh).
  });
}
