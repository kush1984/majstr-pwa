import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button.tsx';
import { routes } from '@/lib/config.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { TEMP_FREE_GETS_ESTIMATE_IMPORT } from '@/features/plan/tempFreeUnlocks.ts';

const DISMISS_KEY = 'majstr.transferCardDismissed';

/**
 * «Вже маєте кошториси чи прайс? Перенесіть їх у Majstr» — the door a new master looks for first
 * (webinar, 2026-11-11: «як мені перенести все в Майстр?»). Shown while he has few objects of his
 * own; «Пізніше» hides it on this device. Profile and catalog keep their own doors to the page.
 */
export function TransferCard({ realObjects }: { realObjects: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const [hidden, setHidden] = useState(readDismissed);

  const allowed = (me?.plan ?? 'FREE') !== 'FREE' || TEMP_FREE_GETS_ESTIMATE_IMPORT;
  if (hidden || !me || !allowed || realObjects >= 3) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Blocked storage: hidden for this visit only.
    }
  };

  return (
    <section className="mb-5 rounded-card border border-border bg-surface p-4" aria-labelledby="transfer-card-title"
      data-testid="transfer-card">
      <div className="flex gap-3">
        <span className="text-2xl leading-none" aria-hidden="true">📥</span>
        <div>
          <h2 id="transfer-card-title" className="text-[15px] font-bold text-primary">{t('transfer.entryTitle')}</h2>
          <p className="mt-0.5 text-xs text-muted">{t('transfer.entryText')}</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" fullWidth onClick={dismiss}>{t('common.later')}</Button>
        <Button fullWidth onClick={() => void navigate(routes.transfer)}>{t('transfer.entryAction')}</Button>
      </div>
    </section>
  );
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}
