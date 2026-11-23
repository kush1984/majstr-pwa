import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { Select } from '@/components/Select.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { useUpdateRegion } from '@/features/profile/useProfile.ts';
import type { Region } from '@/api/types.ts';
import { regionOptions } from './regionOptions.ts';

/** «Пізніше» hides the card on this device for two weeks — then it asks again until answered. */
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;
const SNOOZED = (userId: string) => `majstr.regionAskSnoozedAt.${userId}`;

function snoozed(userId: string): boolean {
  try {
    const at = Number(localStorage.getItem(SNOOZED(userId)));
    return Number.isFinite(at) && at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

/**
 * «У якій області працюєте?» on the home screen (V219) — asked of every master who has not said yet,
 * new and old alike, because regional prices need months of answers before they can be shown. One
 * pick and «Зберегти»; it never comes back once answered (it lives on in the profile).
 */
export function RegionAskCard() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const save = useUpdateRegion();
  const [region, setRegion] = useState<Region | ''>('');
  const [hidden, setHidden] = useState(false);

  if (!me || me.region || me.role === 'ADMIN' || hidden || snoozed(me.id)) return null;

  const onSave = () => {
    if (!region) return;
    save.mutate(region, {
      onSuccess: () => toast.success(t('region.saved')),
      onError: (err) => toast.error(toAppError(err).message),
    });
  };
  const onLater = () => {
    try {
      localStorage.setItem(SNOOZED(me.id), String(Date.now()));
    } catch {
      // Blocked storage: hidden for this visit only.
    }
    setHidden(true);
  };

  return (
    <section className="mb-5 rounded-card border border-border bg-surface p-4" aria-labelledby="region-ask-title">
      <div className="flex items-start justify-between gap-3">
        <h2 id="region-ask-title" className="text-[15px] font-bold text-primary">{t('region.askTitle')}</h2>
        <button type="button" onClick={onLater} className="-mr-1 -mt-1 min-h-[36px] px-1 text-sm font-semibold text-muted">
          {t('region.notNow')}
        </button>
      </div>
      <p className="mt-0.5 text-sm text-muted">{t('region.askText')}</p>
      <div className="mt-3 flex gap-2">
        <Select
          aria-label={t('region.label')}
          className="min-w-0 flex-1"
          value={region}
          onChange={(e) => setRegion(e.target.value as Region | '')}
        >
          <option value="">{t('region.pick')}</option>
          {regionOptions(t).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Button className="flex-shrink-0" disabled={!region} loading={save.isPending} onClick={onSave}>
          {t('region.save')}
        </Button>
      </div>
    </section>
  );
}
