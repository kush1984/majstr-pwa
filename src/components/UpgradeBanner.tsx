import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { routes } from '@/lib/config.ts';

/**
 * Soft PRO upsell shown when a FREE user hits a limit. Not a wall — it explains
 * the cap and links to the Profile screen (where the plan/upgrade lives). Brand
 * styling (amber accent on warm paper) to match the app.
 */
export function UpgradeBanner({ text }: { text: string }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <div className="mb-3 flex items-center gap-3 rounded-card border border-border bg-brand-soft px-3.5 py-2.5">
      <span aria-hidden="true" className="text-base">
        ⭐
      </span>
      <span className="flex-1 text-xs text-primary">{text}</span>
      <button
        type="button"
        onClick={() => navigate(routes.profile)}
        className="whitespace-nowrap text-xs font-bold text-brand"
      >
        {t('limits.upgradeCta')} →
      </button>
    </div>
  );
}
