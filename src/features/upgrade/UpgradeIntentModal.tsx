import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { EmailVerifyModal } from '@/features/email/EmailVerifyModal.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { billingApi } from '@/api/billing.ts';
import { cn } from '@/lib/cn.ts';
import { usePlanLimits } from '@/features/plan/usePlanLimits.ts';
import type { BillingPeriod } from '@/api/types.ts';

export type PurchaseTab = 'pro' | 'object';
/** What the caller came for: only PRO, only one object, or the choice (the object cap). */
export type PurchaseMode = PurchaseTab | 'choice';

/**
 * The one purchase sheet, opened for what the master came for. «Оновити до PRO» shows PRO alone;
 * «Купити обʼєкт разово» shows ONE object without a subscription (V214) alone; the object cap shows
 * both as two tabs under «Обрати тариф», starting on the object. Each panel has its own orange button.
 * Both panels share one grid cell, so switching tabs never changes the sheet's size.
 * Amounts are shown for clarity but owned by the server: PRO sends only the period, the object nothing.
 */
export function UpgradeIntentModal({ open, onClose, mode = 'pro' }: {
  open: boolean;
  onClose: () => void;
  mode?: PurchaseMode;
}) {
  const { t } = useTranslation();
  const limits = usePlanLimits();
  const [busy, setBusy] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [period, setPeriod] = useState<BillingPeriod>('MONTH');
  // Default ON — the price + cadence are shown right next to it (honest opt-in),
  // and it's cancellable in one tap in the profile.
  const [autoRenew, setAutoRenew] = useState(true);
  const startTab: PurchaseTab = mode === 'pro' ? 'pro' : 'object';
  const [tab, setTab] = useState<PurchaseTab>(startTab);

  // Each opening starts on the tab its caller asked for, not on the one left last time.
  useEffect(() => {
    if (open) setTab(startTab);
  }, [open, startTab]);

  const objectPrice = limits.data?.objectPrice;
  const objectOffered = limits.data?.plan === 'FREE' && objectPrice != null;
  // A paying master, or an older server, only ever sees PRO.
  const shown: PurchaseTab = objectOffered && mode !== 'pro' ? tab : 'pro';
  const withTabs = objectOffered && mode === 'choice';
  const title = withTabs ? 'purchase.title' : shown === 'object' ? 'purchase.objectTitle' : 'billing.proTitle';

  const startCheckout = async (checkout: () => Promise<{ pageUrl: string }>) => {
    setBusy(true);
    try {
      const { pageUrl } = await checkout();
      // Leaves the app for the monobank hosted page (or the dev return URL).
      window.location.href = pageUrl;
    } catch (err) {
      setBusy(false); // stay on the modal so the user can retry
      // No payment without a verified email — route to the verify modal (consistent
      // with the trial/share/PDF gates) instead of a bare, out-of-context toast.
      if (toAppError(err).code === 'EMAIL_NOT_VERIFIED') {
        onClose();
        setVerifyOpen(true);
      } else {
        toast.error(toAppError(err).message);
      }
    }
  };
  const pay = () => startCheckout(() =>
    shown === 'object' ? billingApi.checkoutObject() : billingApi.checkout(period, autoRenew));

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

  const tabs: { value: PurchaseTab; label: string }[] = [
    { value: 'pro', label: t('purchase.tabPro') },
    { value: 'object', label: t('purchase.tabObject', { price: objectPrice }) },
  ];

  return (
    <>
    <Modal open={open} onClose={onClose} title={t(title)}>
      <div className="space-y-3">
        {withTabs && (
          <div role="tablist" className="grid grid-cols-2 gap-2">
            {tabs.map((x) => (
              <button
                key={x.value}
                type="button"
                role="tab"
                aria-selected={shown === x.value}
                onClick={() => setTab(x.value)}
                // Both look like buttons: the chosen one filled, the other outlined in the same orange —
                // never a bare white label that does not read as tappable.
                className={cn(
                  'min-h-[44px] rounded-xl border-2 border-brand px-2 text-sm font-semibold transition-colors',
                  shown === x.value ? 'bg-brand text-white shadow-sm' : 'bg-transparent text-brand',
                )}
              >
                {x.label}
              </button>
            ))}
          </div>
        )}

        {/* In the choice, what the chosen tab sells sits in its own frame between the tabs and the pay
            button, so it reads as that tab's content rather than a loose list under two buttons. */}
        <div className={cn('grid', withTabs && 'rounded-xl border border-border p-3')}>
        {(withTabs || shown === 'pro') && (
          <div
            role={withTabs ? 'tabpanel' : undefined}
            aria-hidden={shown !== 'pro'}
            className={cn('col-start-1 row-start-1 space-y-4', shown !== 'pro' && 'invisible')}
          >
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
          </div>
        )}
        {(withTabs || shown === 'object') && (
          <div
            role={withTabs ? 'tabpanel' : undefined}
            aria-hidden={shown !== 'object'}
            className={cn('col-start-1 row-start-1 space-y-3', shown !== 'object' && 'invisible')}
          >
            <p className="text-sm text-secondary">{t('oneOffObject.lead')}</p>
            <ul className={cn(
              'space-y-1.5 text-sm text-primary',
              !withTabs && 'rounded-xl border border-border bg-surface p-3', // the tab frame is enough
            )}>
              {(['pointEstimates', 'pointPhotos', 'pointLogo', 'pointForever'] as const).map((k) => (
                <li key={k} className="flex gap-2">
                  <span aria-hidden="true" className="font-bold text-brand">✓</span>
                  <span>{t(`oneOffObject.${k}`)}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">{t('oneOffObject.noAi')}</p>
            {(limits.data?.objectsBoughtLastMonth ?? 0) > 0 && (
              <p className="text-xs font-semibold text-brand">{t('oneOffObject.proIsCheaper')}</p>
            )}
          </div>
        )}
        </div>

        <Button fullWidth loading={busy} onClick={pay}>
          {shown === 'object' ? t('oneOffObject.pay', { price: objectPrice }) : t('billing.pay')}
        </Button>
      </div>
    </Modal>
    {verifyOpen && (
      <EmailVerifyModal open onClose={() => setVerifyOpen(false)} />
    )}
    </>
  );
}
