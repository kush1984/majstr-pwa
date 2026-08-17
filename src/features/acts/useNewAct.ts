import { useNavigate } from 'react-router-dom';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { routes } from '@/lib/config.ts';
import { useCreateAct } from './useActs.ts';
import type { WorkActResponse } from '@/api/types.ts';

/** Why «+ Новий акт» / «Згенерувати акт» is unavailable: one act is still open, or a FINAL act
 *  already closed the object. Both mirror the backend guards in {@code WorkActCreator}. */
export type ActBlock = 'open' | 'final' | null;

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

export function actCreateBlock(acts: WorkActResponse[]): ActBlock {
  if (acts.some((a) => a.status === 'DRAFT' || a.status === 'SENT')) return 'open';
  if (acts.some((a) => a.kind === 'FINAL')) return 'final';
  return null;
}

/** Default period: from the day after the last SIGNED act's period_to (or the object's creation
 *  date for the first act) up to today. The master edits it in the act screen anyway. */
function defaultPeriodFrom(acts: WorkActResponse[], objectCreatedAt?: string): string {
  const lastSignedTo = acts
    .filter((a) => a.status === 'SIGNED')
    .map((a) => a.periodTo)
    .sort()
    .at(-1);
  if (lastSignedTo) {
    const next = new Date(lastSignedTo + 'T00:00:00');
    next.setDate(next.getDate() + 1);
    return isoDay(next);
  }
  return (objectCreatedAt ?? new Date().toISOString()).slice(0, 10);
}

/** Shared create-then-open flow for both entry points. `scopeEstimateId` (the economy panel
 *  «Згенерувати акт» menu item) restricts the editor to that one estimate's positions; the Acts tab
 *  button passes none, so the act spans every SIGNED estimate on the object. */
export function useNewAct(objectId: string, objectCreatedAt?: string) {
  const navigate = useNavigate();
  const create = useCreateAct(objectId);

  const start = (acts: WorkActResponse[], scopeEstimateId?: string) => {
    const today = isoDay(new Date());
    create.mutate(
      {
        kind: 'INTERIM',
        issuedAt: today,
        periodFrom: defaultPeriodFrom(acts, objectCreatedAt),
        periodTo: today,
        showMaterials: true,
        // The «ДОВІДКОВО» reference only makes sense from the second act on — off by default,
        // the master opts in per act (acts-fix; mirrors the backend WorkActCreator default).
        showCumulative: false,
      },
      {
        onSuccess: (act) => {
          const suffix = scopeEstimateId ? `?scope=${scopeEstimateId}` : '';
          void navigate(routes.act(act.id) + suffix);
        },
        onError: (err) => toast.error(toAppError(err).message),
      },
    );
  };

  return { start, creating: create.isPending };
}
