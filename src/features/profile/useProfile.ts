import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { profileApi } from '@/api/profile.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { CATALOG_KEY } from '@/features/catalog/useCatalog.ts';
import { ESTIMATE_TEMPLATE_KEY } from '@/features/estimate/useEstimateTemplates.ts';
import type {
  HelpRequest, ProfileTradesRequest, ProfileUpdateRequest, Region, RequisitesRequest, SenderProfileRequest, UserResponse,
} from '@/api/types.ts';

/** A trade that was not there before brings its starter catalog server-side, and its bundles join
 *  the picker — both caches are stale the moment the trade set grows. */
function useRefreshAfterTrades() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: CATALOG_KEY });
    void qc.invalidateQueries({ queryKey: ESTIMATE_TEMPLATE_KEY });
  };
}

/** Update the contractor's own profile (#16). Seeds the `['me']` cache with the
 *  returned user so the profile screen reflects changes immediately, then
 *  revalidates. */
export function useUpdateProfile() {
  const qc = useQueryClient();
  const refreshAfterTrades = useRefreshAfterTrades();
  return useMutation({
    mutationFn: (req: ProfileUpdateRequest) => profileApi.update(req),
    onSuccess: (user: UserResponse, req) => {
      const before = qc.getQueryData<UserResponse>(ME_QUERY_KEY)?.trades ?? [];
      qc.setQueryData(ME_QUERY_KEY, user);
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
      if (req.trades.some((t) => !before.includes(t))) refreshAfterTrades();
    },
  });
}

/** Where he works (V219), saved on its own. */
export function useUpdateRegion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (region: Region) => profileApi.updateRegion(region),
    onSuccess: (user: UserResponse) => {
      qc.setQueryData(ME_QUERY_KEY, user);
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

/** «Налаштування» (V217): requisites + payout, saved on their own. */
export function useUpdateRequisites() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: RequisitesRequest) => profileApi.updateRequisites(req),
    onSuccess: (user: UserResponse) => {
      qc.setQueryData(ME_QUERY_KEY, user);
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

/** The trades screen after registration (V190): sets the system trades; an empty set is a skip. */
export function useUpdateTrades() {
  const qc = useQueryClient();
  const refreshAfterTrades = useRefreshAfterTrades();
  return useMutation({
    mutationFn: (req: ProfileTradesRequest) => profileApi.updateTrades(req),
    // Fails at once offline instead of pausing: «Чим займаєтесь?» then keeps the answer and lets him in.
    networkMode: 'always',
    onSuccess: (user: UserResponse) => {
      qc.setQueryData(ME_QUERY_KEY, user);
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
      refreshAfterTrades();
    },
  });
}

/** «Залиште телефон — передзвонимо» (V191). */
export function useRequestHelp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: HelpRequest) => profileApi.requestHelp(req),
    onSuccess: (user: UserResponse) => {
      qc.setQueryData(ME_QUERY_KEY, user);
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
      qc.setQueryData(HELP_OFFER_KEY, null); // asked: the server will offer it no more
    },
  });
}

export const HELP_OFFER_KEY = ['help-offer'] as const;

/** The home screen's setup-help card (V226) — the server decides whether it stands and why. */
export function useHelpOffer(enabled: boolean) {
  return useQuery({
    queryKey: HELP_OFFER_KEY,
    queryFn: () => profileApi.helpOffer(),
    enabled,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
}

/** «Додати номер із Telegram до документів?» (V226) — only this tap copies it. */
export function usePhoneFromTelegram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => profileApi.phoneFromTelegram(),
    onSuccess: (user: UserResponse) => {
      qc.setQueryData(ME_QUERY_KEY, user);
    },
  });
}

/** «Як вас підписати в документі?» — the three fields a document prints, saved to the profile. */
export function useUpdateSender() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: SenderProfileRequest) => profileApi.updateSender(req),
    onSuccess: (user: UserResponse) => {
      qc.setQueryData(ME_QUERY_KEY, user);
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
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
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
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

/** Add a master-invented trade. Primes `['me']` with the returned profile
 *  (customTrades now includes it) so the picker/list update immediately. */
export function useAddCustomTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => profileApi.addCustomTrade(name),
    networkMode: 'always',
    onSuccess: (user: UserResponse) => {
      qc.setQueryData(ME_QUERY_KEY, user);
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

/** Rename a custom trade — a live FK, so every position/template filed under
 *  it picks up the new name as soon as `['me']` (and any refetch) reflects it. */
export function useRenameCustomTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => profileApi.renameCustomTrade(id, name),
    onSuccess: (user: UserResponse) => {
      qc.setQueryData(ME_QUERY_KEY, user);
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

/** Delete a custom trade. Positions/templates filed under it fall back to
 *  "Інше" server-side — nothing here needs to touch the catalog/template caches. */
export function useDeleteCustomTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => profileApi.deleteCustomTrade(id),
    onSuccess: (user: UserResponse) => {
      qc.setQueryData(ME_QUERY_KEY, user);
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}
