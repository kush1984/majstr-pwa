import { useQuery } from '@tanstack/react-query';
import { authApi } from '@/api/auth';
import { tokens } from '@/lib/tokens';
import type { UserResponse } from '@/api/types';

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
    retry: false,             // 401 already chased by interceptor; no point retrying
  });
}
