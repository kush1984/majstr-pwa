import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { upgradeApi } from '@/api/upgrade.ts';
import { UpgradeIntentModal } from '@/features/upgrade/UpgradeIntentModal.tsx';

/**
 * Soft PRO upsell shown when a FREE user hits a limit. Clicking the CTA records
 * the click (best-effort, by trigger) and opens the painted-door modal — instead
 * of the old navigate-to-profile dead-end. Brand styling (amber on warm paper).
 */
export function UpgradeBanner({ text, trigger }: { text: string; trigger: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const onClick = () => {
    void upgradeApi.click(trigger); // fire-and-forget; never blocks the modal
    setOpen(true);
  };

  return (
    <div className="mb-3 flex items-center gap-3 rounded-card border border-border bg-brand-soft px-3.5 py-2.5">
      <span aria-hidden="true" className="text-base">
        ⭐
      </span>
      <span className="flex-1 text-xs text-primary">{text}</span>
      <button
        type="button"
        onClick={onClick}
        className="whitespace-nowrap text-xs font-bold text-brand"
      >
        {t('limits.upgradeCta')} →
      </button>
      <UpgradeIntentModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
