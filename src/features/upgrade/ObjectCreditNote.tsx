import { useTranslation } from 'react-i18next';
import { isAtLimit } from '@/features/plan/usePlanLimits.ts';
import type { PlanLimits } from '@/api/types.ts';

/**
 * At the FREE object cap with a bought one-off object (V214) not created yet. The cap banner is gone
 * (one more object IS allowed), so this says what changed and what did not: still FREE, one paid
 * object waiting for «Новий обʼєкт».
 */
export function ObjectCreditNote({ limits }: { limits: PlanLimits | undefined }) {
  const { t } = useTranslation();
  if (!limits || (limits.objectCredits ?? 0) <= 0 || !isAtLimit(limits.projectsUsed, limits.maxProjects)) {
    return null;
  }
  return (
    <div className="mb-3 flex items-center gap-3 rounded-card border border-border bg-brand-soft px-3.5 py-2.5">
      <span aria-hidden="true" className="text-base">✅</span>
      <span className="flex-1 text-xs text-primary">{t('oneOffObject.creditReady')}</span>
    </div>
  );
}
