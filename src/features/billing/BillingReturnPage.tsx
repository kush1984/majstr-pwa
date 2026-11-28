import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useMe, ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { usePlanLimits, PLAN_LIMITS_KEY } from '@/features/plan/usePlanLimits.ts';
import { Spinner } from '@/components/Spinner.tsx';
import { routes } from '@/lib/config.ts';
import { projectsApi } from '@/api/projects.ts';
import { PROJECTS_KEY } from '@/features/projects/useProjects.ts';

/**
 * Landing after the monobank redirect. The grant happens server-side via the
 * webhook, which may arrive a moment after the payer returns — so we poll until
 * it shows (or a timeout), then show the result. A PRO purchase waits for the plan
 * to flip; a one-off object (`?for=object`, V214) waits for the object credit and
 * then sends the master to create that object — or, with `&unlock=<id>` (iteration-read-only-objects),
 * spends it on that existing view-only object and sends him back into it.
 */
export function BillingReturnPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const forObject = params.get('for') === 'object';
  const { data: me } = useMe();
  const limits = usePlanLimits();
  const [timedOut, setTimedOut] = useState(false);
  const isPro = (me?.plan ?? 'FREE') !== 'FREE';
  const hasObject = (limits.data?.objectCredits ?? 0) > 0;
  const done = forObject ? hasObject : isPro;
  const unlockId = forObject ? params.get('unlock') : null;
  // 'idle' until the credit lands; a failed unlock (it became writable meanwhile, say) falls back to
  // the ordinary «create your object» — the credit is still his.
  const [unlock, setUnlock] = useState<'idle' | 'busy' | 'ok' | 'failed'>('idle');
  const unlockStarted = useRef(false);

  useEffect(() => {
    if (!done || !unlockId || unlockStarted.current) return;
    unlockStarted.current = true;
    setUnlock('busy');
    projectsApi.unlock(unlockId)
      .then(() => {
        setUnlock('ok');
        void qc.invalidateQueries({ queryKey: PROJECTS_KEY });
        void qc.invalidateQueries({ queryKey: PLAN_LIMITS_KEY });
      })
      .catch(() => setUnlock('failed'));
  }, [done, unlockId, qc]);

  useEffect(() => {
    if (done) return;
    let tries = 0;
    const id = setInterval(() => {
      tries += 1;
      // Both, whatever was bought: PRO lifts the limits too, and stale limits kept a new PRO
      // master behind the FREE object cap for minutes.
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
      void qc.invalidateQueries({ queryKey: PLAN_LIMITS_KEY });
      if (tries >= 15) {
        clearInterval(id);
        setTimedOut(true);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [done, qc]);

  // Once it has landed (or already had, before this page opened), read both afresh one more time:
  // the cached limits otherwise go on showing the old plan and the old object count for minutes.
  useEffect(() => {
    if (!done) return;
    void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    void qc.invalidateQueries({ queryKey: PLAN_LIMITS_KEY });
  }, [done, qc]);

  const cta = (
    <Link
      to={routes.home}
      className="rounded-xl bg-brand px-5 py-3 text-sm font-bold text-white"
    >
      {t('billing.toDashboard')}
    </Link>
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      {done && unlockId && unlock === 'ok' ? (
        <>
          <p className="text-4xl">🎉</p>
          <p className="text-lg font-bold text-primary">{t('oneOffObject.unlockedTitle')}</p>
          <p className="text-sm text-secondary">{t('oneOffObject.unlockedBody')}</p>
          <Link
            to={routes.project(unlockId)}
            className="rounded-xl bg-brand px-5 py-3 text-sm font-bold text-white"
          >
            {t('oneOffObject.openObject')}
          </Link>
        </>
      ) : done && unlockId && unlock !== 'failed' ? (
        <>
          <Spinner />
          <p className="text-sm text-secondary">{t('billing.processing')}</p>
        </>
      ) : done && forObject ? (
        <>
          <p className="text-4xl">🎉</p>
          <p className="text-lg font-bold text-primary">{t('oneOffObject.successTitle')}</p>
          <p className="text-sm text-secondary">{t('oneOffObject.successBody')}</p>
          <Link
            to={routes.newObject}
            className="rounded-xl bg-brand px-5 py-3 text-sm font-bold text-white"
          >
            {t('oneOffObject.createNow')}
          </Link>
        </>
      ) : done ? (
        <>
          <p className="text-4xl">🎉</p>
          <p className="text-lg font-bold text-primary">{t('billing.successTitle')}</p>
          <p className="text-sm text-secondary">
            {me?.planExpiresAt
              ? t('billing.successUntil', {
                  date: new Date(me.planExpiresAt).toLocaleDateString('uk-UA'),
                })
              : t('billing.successBody')}
          </p>
          {cta}
        </>
      ) : timedOut ? (
        <>
          <p className="text-sm text-secondary">{t('billing.pending')}</p>
          {cta}
        </>
      ) : (
        <>
          <Spinner />
          <p className="text-sm text-secondary">{t('billing.processing')}</p>
        </>
      )}
    </div>
  );
}
