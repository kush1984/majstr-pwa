import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
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
      toast.error(toAppError(err).message);
      setBusy(false); // stay on the modal so the user can retry
    }
  };

  const periods: { value: BillingPeriod; title: string; price: string; note?: string }[] = [
    { value: 'MONTH', title: t('billing.periodMonth'), price: t('billing.periodMonthPrice') },
    {
      value: 'HALF_YEAR',
      title: t('billing.periodHalfYear'),
      price: t('billing.periodHalfYearPrice'),
      note: t('billing.periodHalfYearNote'),
    },
  ];

  return (
    <Modal open={open} onClose={onClose} title={t('billing.proTitle')}>
      <div className="space-y-4">
        <p className="text-sm text-secondary">{t('billing.proBody')}</p>

        <div className="grid grid-cols-2 gap-2.5">
          {periods.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriod(p.value)}
              className={cn(
                'relative rounded-xl border p-3 text-left transition-colors',
                period === p.value ? 'border-brand bg-brand-soft' : 'border-border bg-surface',
              )}
            >
              {p.value === 'HALF_YEAR' && (
                <span className="absolute -top-2 right-2 rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold text-white">
                  {t('billing.periodBadge')}
                </span>
              )}
              <span className="block text-sm font-semibold text-primary">{p.title}</span>
              <span className="mt-1 block text-lg font-extrabold text-primary">{p.price}</span>
              {p.note && <span className="mt-0.5 block text-xs text-muted">{p.note}</span>}
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
              {period === 'HALF_YEAR' ? t('billing.autoRenewHintHalfYear') : t('billing.autoRenewHint')}
            </span>
          </span>
        </label>

        <Button fullWidth loading={busy} onClick={pay}>
          {t('billing.pay')}
        </Button>
        <p className="text-center text-xs text-muted">{t('billing.securedBy')}</p>
      </div>
    </Modal>
  );
}
