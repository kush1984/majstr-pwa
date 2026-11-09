import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { useMe } from '@/features/auth/useMe.ts';
import { usePlanLimits } from '@/features/plan/usePlanLimits.ts';
import { useStartTrial } from '@/features/plan/useStartTrial.ts';
import { markVerifiedTrialOfferSeen, wantsVerifiedTrialOffer } from '@/features/email/trialOffer.ts';

/**
 * «Пошту підтверджено — увімкнути N днів PRO?» — the second half of the trial card's promise
 * (`trialOffer.ts`): verifying does not turn PRO on, so the dashboard asks once, the first time `me`
 * says the email this device saw unverified is now verified. «Пізніше» is remembered on the device.
 */
export function VerifiedTrialCard() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const { data: limits } = usePlanLimits();
  const trial = useStartTrial();
  const [hidden, setHidden] = useState(false);

  if (hidden || !me || !limits?.trialDays || !wantsVerifiedTrialOffer(me)) return null;

  const done = () => {
    markVerifiedTrialOfferSeen(me.id);
    setHidden(true);
  };

  const onEnable = async () => {
    if (await trial.start()) done();
  };

  return (
    <section className="mb-5 rounded-card border border-border bg-surface p-4" aria-labelledby="verified-trial-title">
      <div className="flex gap-3">
        <span className="text-2xl leading-none" aria-hidden="true">🎁</span>
        <h2 id="verified-trial-title" className="text-[15px] font-bold text-primary">
          {t('verifiedTrial.title', { count: limits.trialDays })}
        </h2>
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" fullWidth onClick={done}>{t('common.later')}</Button>
        <Button fullWidth loading={trial.pending} onClick={() => void onEnable()}>{t('verifiedTrial.enable')}</Button>
      </div>
    </section>
  );
}
