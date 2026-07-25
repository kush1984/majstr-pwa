import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { EmailVerifyModal } from '@/features/email/EmailVerifyModal.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { billingApi } from '@/api/billing.ts';
import { cn } from '@/lib/cn.ts';
import type { BillingPeriod } from '@/api/types.ts';

/**
 * PRO purchase modal. The master picks a period (monthly, or the discounted
 * half-year) and optionally opts into auto-renewal, then "Оплатити" starts a
 * monobank checkout and redirects to the hosted payment page. Amounts are shown
 * for clarity but owned by the server — the client only sends the period.
 */
export function UpgradeIntentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [period, setPeriod] = useState<BillingPeriod>('MONTH');
  // Default ON — the price + cadence are shown right next to it (honest opt-in),
  // and it's cancellable in one tap in the profile.
  const [autoRenew, setAutoRenew] = useState(true);

  const pay = async () => {
    setBusy(true);
    try {
      const { pageUrl } = await billingApi.checkout(period, autoRenew);
      // Leaves the app for the monobank hosted page (or the dev return URL).
      window.location.href = pageUrl;
    } catch (err) {
      setBusy(false); // stay on the modal so the user can retry
      // No PRO without a verified email — route to the verify modal (consistent
      // with the trial/share/PDF gates) instead of a bare, out-of-context toast.
      if (toAppError(err).code === 'EMAIL_NOT_VERIFIED') {
        onClose();
        setVerifyOpen(true);
      } else {
        toast.error(toAppError(err).message);
      }
    }
  };

  // Cheapest-per-month last: the eye lands on the annual tariff after seeing the others.
  const periods: { value: BillingPeriod; title: string; price: string; note?: string; badge?: string }[] = [
    { value: 'MONTH', title: t('billing.periodMonth'), price: t('billing.periodMonthPrice') },
    {
      value: 'HALF_YEAR',
      title: t('billing.periodHalfYear'),
      price: t('billing.periodHalfYearPrice'),
      note: t('billing.periodHalfYearNote'),
    },
    {
      value: 'YEAR',
      title: t('billing.periodYear'),
      price: t('billing.periodYearPrice'),
      note: t('billing.periodYearNote'),
      badge: t('billing.periodBadge'),
    },
  ];

  const autoRenewHint: Record<BillingPeriod, string> = {
    MONTH: t('billing.autoRenewHint'),
    HALF_YEAR: t('billing.autoRenewHintHalfYear'),
    YEAR: t('billing.autoRenewHintYear'),
  };

  return (
    <>
    <Modal open={open} onClose={onClose} title={t('billing.proTitle')}>
      <div className="space-y-4">
        <p className="text-sm text-secondary">{t('billing.proBody')}</p>

        {/* Stacked rows, not a grid: three tariffs side by side crush the per-month
            saving note at 375px, and that note is what sells the longer period. */}
        <div className="space-y-2">
          {periods.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriod(p.value)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                period === p.value ? 'border-brand bg-brand-soft' : 'border-border bg-surface',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold text-primary">{p.title}</span>
                  {p.badge && (
                    <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {p.badge}
                    </span>
                  )}
                </span>
                {p.note && <span className="mt-0.5 block text-xs text-muted">{p.note}</span>}
              </span>
              <span className="whitespace-nowrap text-lg font-extrabold text-primary">{p.price}</span>
            </button>
          ))}
        </div>

        <label className="flex items-start gap-2.5 rounded-xl bg-surface p-3 text-sm text-primary">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-border text-brand focus:ring-brand"
            checked={autoRenew}
            onChange={(e) => setAutoRenew(e.target.checked)}
          />
          <span>
            {t('billing.autoRenewLabel')}
            <span className="mt-0.5 block text-xs text-muted">
              {autoRenewHint[period]}
            </span>
          </span>
        </label>

        <Button fullWidth loading={busy} onClick={pay}>
          {t('billing.pay')}
        </Button>
        <p className="text-center text-xs text-muted">{t('billing.securedBy')}</p>
      </div>
    </Modal>
    {verifyOpen && (
      <EmailVerifyModal open onClose={() => setVerifyOpen(false)} />
    )}
    </>
  );
}
