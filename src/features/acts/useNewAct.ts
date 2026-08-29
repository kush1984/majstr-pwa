import { useNavigate } from 'react-router-dom';
import { routes } from '@/lib/config.ts';
import type { WorkActResponse } from '@/api/types.ts';

/** Why «+ Новий акт» / «Згенерувати акт» is unavailable: one act is still open, or a FINAL act
 *  already closed the object. Both mirror the backend guards in {@code WorkActCreator}. */
export type ActBlock = 'open' | 'final' | null;

// LOCAL calendar day, not toISOString() (which is UTC): issuedAt is the legal date on the document,
// and before ~03:00 Kyiv time the UTC date is still yesterday (review fix).
export const isoDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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
  // createdAt is a UTC instant — take the LOCAL day it falls on, same rule as isoDay.
  return isoDay(objectCreatedAt ? new Date(objectCreatedAt) : new Date());
}

/**
 * Open the editor on a NEW act. Nothing is created here: «Новий акт» used to POST a draft the
 * instant it was tapped, so a mistaken tap and a Back left a real numbered act on the object
 * («може випадково натиснули»). The act is now born on «Зберегти» — until then it lives only in the
 * editor's state, and leaving asks first.
 *
 * <p>The defaults ride the query string because there is no row to read them from yet: the period
 * start depends on the object's acts, which this side already has loaded and the editor does not.
 * `scopeEstimateId` (the economy panel's «Згенерувати акт») restricts the editor to that one
 * estimate's positions; the Acts tab button passes none, so every SIGNED estimate is offered.</p>
 */
export function useNewAct(objectId: string, objectCreatedAt?: string) {
  const navigate = useNavigate();

  const start = (acts: WorkActResponse[], scopeEstimateId?: string) => {
    const params = new URLSearchParams({ from: defaultPeriodFrom(acts, objectCreatedAt) });
    if (scopeEstimateId) params.set('scope', scopeEstimateId);
    void navigate(`${routes.newAct(objectId)}&${params.toString()}`);
  };

  return { start };
}
