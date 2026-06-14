import { useMutation, useQueryClient } from '@tanstack/react-query';
import { profileApi } from '@/api/profile.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import type { ProfileUpdateRequest, UserResponse } from '@/api/types.ts';

/** Update the contractor's own profile (#16). Seeds the `['me']` cache with the
 *  returned user so the profile screen reflects changes immediately, then
 *  revalidates. */
export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: ProfileUpdateRequest) => profileApi.update(req),
    onSuccess: (user: UserResponse) => {
      qc.setQueryData(ME_QUERY_KEY, user);
      qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

/** Upload the company logo. The endpoint returns the updated user, so we prime
 *  the `['me']` cache → the preview + any logo usage refresh immediately. */
export function useUploadLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => profileApi.uploadLogo(file),
    onSuccess: (user: UserResponse) => {
      qc.setQueryData(ME_QUERY_KEY, user);
      qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

/** Remove the company logo. The DELETE returns nothing, so we just revalidate
 *  `['me']` (its `logoUrl` becomes null). */
export function useDeleteLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => profileApi.deleteLogo(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_QUERY_KEY }),
  });
}
