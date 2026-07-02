import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useMe, ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { Spinner } from '@/components/Spinner.tsx';
import { routes } from '@/lib/config.ts';

/**
 * Landing after the monobank redirect. The PRO grant happens server-side via the
 * webhook, which may arrive a moment after the payer returns — so we poll /me
 * until the plan flips to PRO (or a timeout), then show the result.
 */
export function BillingReturnPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [timedOut, setTimedOut] = useState(false);
  const isPro = (me?.plan ?? 'FREE') !== 'FREE';

  useEffect(() => {
    if (isPro) return;
    let tries = 0;
    const id = setInterval(() => {
      tries += 1;
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
      if (tries >= 15) {
        clearInterval(id);
        setTimedOut(true);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [isPro, qc]);

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
      {isPro ? (
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
