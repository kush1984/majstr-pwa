import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { billingApi } from '@/api/billing.ts';
import { toAppError } from '@/api/errors.ts';
import { toast } from '@/hooks/useToast.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { PLAN_LIMITS_KEY } from '@/features/plan/usePlanLimits.ts';

/** Turns the PRO trial on — the Profile button and the «Пошту підтверджено» card share this one call. */
export function useStartTrial() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);

  const start = async (): Promise<boolean> => {
    setPending(true);
    try {
      const updated = await billingApi.startTrial();
      qc.setQueryData(ME_QUERY_KEY, updated);
      // The limits follow the plan: without this the FREE banner and a disabled «Новий обʼєкт» stay up to staleTime.
      void qc.invalidateQueries({ queryKey: PLAN_LIMITS_KEY });
      toast.success(
        t('billing.trialStarted', {
          date: updated.planExpiresAt
            ? new Date(updated.planExpiresAt).toLocaleDateString('uk-UA')
            : '',
        }),
      );
      return true;
    } catch (err) {
      toast.error(toAppError(err).message);
      return false;
    } finally {
      setPending(false);
    }
  };

  return { start, pending };
}
