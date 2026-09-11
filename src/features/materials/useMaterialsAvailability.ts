import { useQuery } from '@tanstack/react-query';
import { materialsApi } from '@/api/materials.ts';

export const MATERIALS_AVAILABILITY_KEY = (estimateId: string) =>
  ['materials-availability', estimateId] as const;

/**
 * Should the «Матеріали» entry points be shown for this estimate at all? (V129)
 *
 * <p>V127 knows norms for DRYWALL only. On a tiling or painting estimate the calculator opens with
 * every position listed as a gap and an empty buying list, which the master read as the app being
 * broken rather than the trade being uncovered — «воно збиває з толку». So the screen is not
 * disabled or explained, it is simply absent until we can answer something.</p>
 *
 * <p><b>Unknown means SHOW.</b> Offline, on an error, or while the probe is still in flight there
 * is no verdict — and hiding a working feature because a cheap GET has not landed yet is the worse
 * mistake of the two: a missing button reads as a missing feature, while an empty calculator at
 * least reads as an answer. Only a definite `available: false` hides anything.</p>
 */
export function useMaterialsAvailability(estimateId: string, enabled = true): boolean {
  const { data } = useQuery({
    queryKey: MATERIALS_AVAILABILITY_KEY(estimateId),
    queryFn: () => materialsApi.availability(estimateId),
    enabled: Boolean(estimateId) && enabled,
    staleTime: 60_000,
    retry: false,
  });
  return data?.available ?? true;
}
