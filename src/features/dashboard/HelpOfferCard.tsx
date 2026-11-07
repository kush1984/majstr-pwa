import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { useRequestHelp } from '@/features/profile/useProfile.ts';

const DISMISSED = (userId: string) => `majstr.helpOfferDismissed.${userId}`;

function wasDismissed(userId: string): boolean {
  try {
    return localStorage.getItem(DISMISSED(userId)) === '1';
  } catch {
    return false;
  }
}

/**
 * «Потрібна допомога з налаштуванням? Залиште телефон — передзвонимо» (V191).
 *
 * <p>Registration stopped asking for a phone (V190): a number asked of a stranger at the door was the
 * biggest reason to leave. Here it is OFFERED, to someone already inside, for something he gets back —
 * a call. Shown only while there is no phone on the account and he has neither asked nor said «Ні,
 * дякую» on this device. The number lands in the profile and in the admin's call list.</p>
 */
export function HelpOfferCard() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const requestHelp = useRequestHelp();
  const [phone, setPhone] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [sent, setSent] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (!me) return null;
  if (sent) {
    return (
      <div className="mb-5 rounded-card border border-border bg-surface p-4 text-sm text-primary" role="status">
        {t('helpOffer.thanks')}
      </div>
    );
  }
  if (dismissed || me.phone || me.helpRequestedAt || wasDismissed(me.id)) return null;

  const onSend = async () => {
    const value = phone.trim();
    if (value.length < 5) {
      setInvalid(true);
      return;
    }
    try {
      await requestHelp.mutateAsync({ phone: value });
      setSent(true);
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const onDismiss = () => {
    try {
      localStorage.setItem(DISMISSED(me.id), '1');
    } catch {
      // Blocked storage: it is hidden for this visit only.
    }
    setDismissed(true);
  };

  return (
    <section className="mb-5 rounded-card border border-border bg-surface p-4" aria-labelledby="help-offer-title">
      <h2 id="help-offer-title" className="text-[15px] font-bold text-primary">{t('helpOffer.title')}</h2>
      <p className="mt-1 text-sm text-muted">{t('helpOffer.body')}</p>
      <div className="mt-3">
        <Input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          aria-label={t('common.phone')}
          placeholder={t('auth.phonePlaceholder')}
          value={phone}
          invalid={invalid}
          onChange={(e) => { setPhone(e.target.value); setInvalid(false); }}
        />
        {invalid && <p className="mt-1 text-xs text-red-600">{t('validation.enterPhone')}</p>}
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" fullWidth onClick={onDismiss}>{t('helpOffer.dismiss')}</Button>
        <Button fullWidth loading={requestHelp.isPending} onClick={() => void onSend()}>{t('helpOffer.send')}</Button>
      </div>
    </section>
  );
}
