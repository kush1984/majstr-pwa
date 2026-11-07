import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalFooter } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { FormField } from '@/components/FormField.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { useUpdateSender } from '@/features/profile/useProfile.ts';
import { senderSheetStore } from './senderGate.ts';
import { isCallablePhone } from '@/lib/phone.ts';

/**
 * The «Як вас підписати в документі?» sheet (V190) — one instance for the whole app, opened by
 * `useSenderGate`. Only the name is required; phone and company are optional, and an empty company
 * prints the name (the backend's `ContractorName`, previewed here as the client will read it).
 *
 * <p>What he types is saved to the profile straight away, and the sheet says so: the profile is the
 * only place a document's header comes from, so «don't save» would only mean being asked again on
 * every send. A signed document keeps its own copy (V150), so changing it later rewrites nothing.</p>
 *
 * <p>The same sheet, in `extras` mode, is the light reminder when the name is there but the phone is
 * empty: «Пропустити» sends the document as it is. A one-off value «just for this
 * document» is not offered — the header has no other source than the profile, so it would print
 * nothing; the button says plainly that it saves for the next estimates too.</p>
 */
export function SenderSheetHost() {
  const { t } = useTranslation();
  const open = useSyncExternalStore(senderSheetStore.subscribe, senderSheetStore.isOpen);
  const mode = useSyncExternalStore(senderSheetStore.subscribe, senderSheetStore.mode);
  const reminder = mode === 'extras';
  const { data: me } = useMe();
  const save = useUpdateSender();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [nameMissing, setNameMissing] = useState(false);

  // Seeded once per opening: a refetch of `me` while he types must not undo his typing.
  const seeded = useRef(false);
  useEffect(() => {
    if (!open) {
      seeded.current = false;
      return;
    }
    if (seeded.current) return;
    seeded.current = true;
    setFullName(me?.fullName ?? '');
    setPhone(me?.phone ?? '');
    setCompanyName(me?.companyName ?? '');
    setNameMissing(false);
  }, [open, me]);

  const onSave = async () => {
    const name = fullName.trim();
    if (!name) {
      setNameMissing(true);
      return;
    }
    try {
      await save.mutateAsync({ fullName: name, phone: phone.trim(), companyName: companyName.trim() });
      toast.success(t('sender.saved'));
      senderSheetStore.settle(true);
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const header = companyName.trim() || fullName.trim();

  return (
    <Modal
      open={open}
      onClose={() => senderSheetStore.settle(false)}
      title={t(reminder ? 'sender.reminderTitle' : 'sender.title')}
    >
      <div className="ph-mask space-y-4">
        <p className="text-sm text-muted">{t(reminder ? 'sender.reminderIntro' : 'sender.intro')}</p>

        <FormField
          label={t('sender.fullName')}
          htmlFor="sender-name"
          required
          hint={nameMissing ? undefined : t('sender.fullNameHint')}
          error={nameMissing ? t('validation.enterFullName') : undefined}
        >
          <Input
            id="sender-name"
            autoFocus
            autoComplete="name"
            value={fullName}
            invalid={nameMissing}
            onChange={(e) => { setFullName(e.target.value); setNameMissing(false); }}
          />
        </FormField>

        <FormField
          label={t('common.phone')}
          htmlFor="sender-phone"
          hint={phone.trim() && !isCallablePhone(phone) ? t('sender.phoneCheck') : t('sender.phoneHint')}
        >
          <Input
            id="sender-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={t('auth.phonePlaceholder')}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </FormField>

        <FormField label={t('auth.companyName')} htmlFor="sender-company" hint={t('sender.companyHint')}>
          <Input
            id="sender-company"
            autoComplete="organization"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
        </FormField>

        {header && (
          <div className="rounded-card border border-border bg-surface-sunken px-3 py-2.5" aria-live="polite">
            <p className="text-xs text-muted">{t('sender.preview')}</p>
            <p className="mt-0.5 font-bold text-primary">{header}</p>
            {phone.trim() && <p className="text-sm text-primary">{phone.trim()}</p>}
          </div>
        )}

        <p className="text-xs text-muted">{t(reminder ? 'sender.reminderSavedToProfile' : 'sender.savedToProfile')}</p>
      </div>

      <ModalFooter>
        <div className="flex gap-2">
          <Button variant="secondary" fullWidth onClick={() => senderSheetStore.settle(false)}>
            {t(reminder ? 'sender.skip' : 'common.cancel')}
          </Button>
          <Button fullWidth loading={save.isPending} onClick={() => void onSave()}>
            {t(reminder ? 'sender.saveToProfile' : 'sender.continue')}
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
