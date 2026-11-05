import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { economyApi } from '@/api/economy.ts';
import { CLIENT_DRIVEN_QUERY } from '@/lib/clientDrivenQuery.ts';
import { estimatesApi } from '@/api/estimates.ts';

/**
 * Query key for one object's economy.
 *
 * <p>`expenses` went with the journal SCREEN: nothing has read `['object-expenses', …]` since
 * «Прибуток» came off the object, so invalidating it refreshed nothing while reading as if it did
 * (review P-48/P-52). An expense is still written — a till receipt flipped to «моя витрата» posts
 * one — and the surface that shows it now is «Мої гроші», which is what the writers invalidate.</p>
 */

/**
 * An object's money changed: its economy, AND «Мої гроші» — which unions every object's receipts and
 * expenses — with the home strip's summary under the same ['cash'] prefix. A payment entered on the
 * object used to leave both showing the old figures until they happened to refetch (review P1-19).
 */
export function invalidateObjectMoney(qc: QueryClient, objectId: string): void {
  void qc.invalidateQueries({ queryKey: economyKeys.economy(objectId) });
  void qc.invalidateQueries({ queryKey: ['object-money', objectId] });
  void qc.invalidateQueries({ queryKey: ['cash'] });
}

export const economyKeys = {
  economy: (objectId: string) => ['object-economy', objectId] as const,
};

/**
 * The economy tab's data — panels + payments are FREE-visible, so this is always fetched.
 * `internals` comes back null for FREE.
 */
export function useEconomy(objectId: string) {
  return useQuery({
    ...CLIENT_DRIVEN_QUERY,
    queryKey: economyKeys.economy(objectId),
    queryFn: () => economyApi.economy(objectId),
    enabled: Boolean(objectId),
  });
}

/** «Не враховувати цей акт» / «Враховувати» — the act's own ⋮ menu (economy-polish iteration;
 *  moved off the Кошторис tab, which only ever shows unsigned drafts now). `objectId` doubles as
 *  the project id everywhere in this module. */
export function useToggleEstimateCounted(objectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { estimateId: string; value: boolean }) =>
      estimatesApi.setCountInEconomy(v.estimateId, v.value),
    onSuccess: () => {
      invalidateObjectMoney(qc, objectId);
      void qc.invalidateQueries({ queryKey: ['project-estimates', objectId] });
      // `progress` skips an estimate that does not count, which is the whole point of the toggle:
      // an open act editor reading the old progress would still offer lines it may no longer
      // close, and the object card reads Σ SIGNED ∧ counted (review P-48).
      void qc.invalidateQueries({ queryKey: ['act-progress'] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
