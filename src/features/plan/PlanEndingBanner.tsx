import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useMe } from '@/features/auth/useMe.ts';
import { routes } from '@/lib/config.ts';

const WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DISMISS_KEY = 'majstr.planEndingDismissed';

/**
 * «PRO закінчується 14.12 — далі буде FREE» over the last three days of a paid term that ENDS
 * rather than renews (auto-renew with a saved card renews, so it says nothing). The server sends the
 * same warning by push and email (PlanEndingReminderService); this is the one a master sees without
 * either. «✕» hides it until the last day, which asks once more.
 */
export function PlanEndingBanner({ now = Date.now() }: { now?: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const [dismissed, setDismissed] = useState(readDismissed);

  if (!me || me.plan === 'FREE' || !me.planExpiresAt) return null;
  if (me.autoRenew && me.cardMask) return null;
  const left = new Date(me.planExpiresAt).getTime() - now;
  if (left <= 0 || left > WINDOW_MS) return null;
  // The stage this view belongs to: dismissing three days out does not hide the last day.
  const stage = `${me.planExpiresAt}:${left <= DAY_MS ? 'last' : 'first'}`;
  if (dismissed === stage) return null;

  const dismiss = () => {
    setDismissed(stage);
    try {
      localStorage.setItem(DISMISS_KEY, stage);
    } catch {
      // Private mode or blocked storage: hidden for this visit only.
    }
  };

  return (
    <div
      data-testid="plan-ending-banner"
      className="mb-4 flex flex-col gap-2.5 rounded-card border border-amber/30 bg-amber-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-2.5">
        <span className="text-lg leading-none">⏳</span>
        <div>
          <div className="text-sm font-semibold text-primary">
            {t('planEnding.title', { date: new Date(me.planExpiresAt).toLocaleDateString('uk-UA') })}
          </div>
          <div className="text-xs text-muted">{t('planEnding.text')}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 self-start sm:self-auto">
        <button
          type="button"
          onClick={() => void navigate(routes.profile)}
          className="min-h-[44px] rounded-lg bg-surface px-3 text-xs font-semibold text-primary shadow-card"
        >
          {t('planEnding.action')}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('common.close')}
          className="min-h-[44px] min-w-[44px] text-base text-faint"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}
