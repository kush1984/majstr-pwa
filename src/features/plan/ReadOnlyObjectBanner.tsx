import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { upgradeApi } from '@/api/upgrade.ts';
import { projectsApi } from '@/api/projects.ts';
import { toAppError } from '@/api/errors.ts';
import { toast } from '@/hooks/useToast.ts';
import { UpgradeIntentModal } from '@/features/upgrade/UpgradeIntentModal.tsx';
import { usePlanLimits, PLAN_LIMITS_KEY } from '@/features/plan/usePlanLimits.ts';
import { PROJECTS_KEY } from '@/features/projects/useProjects.ts';

/**
 * The one line every screen of a view-only object shows (iteration-read-only-objects): why nothing
 * here can be changed, and the two ways back — PRO, or buy THIS object for good (149 ₴, the one-off
 * object of V214). A credit already bought unlocks it at once. The object itself stays open: sharing
 * and PDFs work as usual. The server decides (`Project.readOnly`, `ObjectWriteGuard`); this only says it.
 */
export function ReadOnlyObjectBanner({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const limits = usePlanLimits();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const credits = limits.data?.objectCredits ?? 0;
  // The one-off purchase is FREE's; an older server without it only offers PRO.
  const objectOffered = limits.data?.plan === 'FREE' && limits.data.objectPrice != null;

  const unlockWithCredit = async () => {
    setBusy(true);
    try {
      await projectsApi.unlock(projectId);
      toast.success(t('oneOffObject.unlocked'));
      void qc.invalidateQueries({ queryKey: PROJECTS_KEY });
      void qc.invalidateQueries({ queryKey: PLAN_LIMITS_KEY });
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const onClick = () => {
    if (busy) return;
    if (objectOffered && credits > 0) {
      void unlockWithCredit();
      return;
    }
    void upgradeApi.click('READ_ONLY_OBJECT'); // fire-and-forget; never blocks the sheet
    setOpen(true);
  };

  return (
    <div className="mb-3 flex items-center gap-3 rounded-card border border-border bg-brand-soft px-3.5 py-2.5">
      <span aria-hidden="true" className="text-base">
        🔒
      </span>
      <span className="flex-1 text-xs text-primary">
        {t('limits.readOnlyObject', { max: limits.data?.maxProjects ?? 2 })}
      </span>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="min-h-[44px] whitespace-nowrap text-xs font-bold text-brand disabled:opacity-60"
      >
        {t(objectOffered ? 'oneOffObject.unlockCta' : 'limits.upgradeCta')} →
      </button>
      <UpgradeIntentModal
        open={open}
        onClose={() => setOpen(false)}
        mode={objectOffered ? 'choice' : 'pro'}
        unlockProjectId={projectId}
      />
    </div>
  );
}
