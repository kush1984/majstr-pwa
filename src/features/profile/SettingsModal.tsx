import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Select } from '@/components/Select.tsx';
import { Checkbox } from '@/components/Checkbox.tsx';
import { FormField } from '@/components/FormField.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { cardWarning, linkWarning, rnokppWarning, vatIdWarning } from '@/lib/requisites.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { useUpdateRequisites } from './useProfile.ts';
import type { ActNumberFormat, UserResponse } from '@/api/types.ts';

/** Kept as strings for the inputs; taxGroup/taxRate are parsed to numbers on save. */
interface SettingsState {
  legalName: string;
  taxId: string;
  legalAddress: string;
  iban: string;
  bankName: string;
  docCity: string;
  vatPayer: boolean;
  vatId: string;
  taxGroup: string;
  taxRate: string;
  actNumberFormat: ActNumberFormat;
  payoutCard: string;
  payoutLink: string;
}

function seeded(me: UserResponse): SettingsState {
  return {
    legalName: me.legalName ?? '',
    taxId: me.taxId ?? '',
    legalAddress: me.legalAddress ?? '',
    iban: me.iban ?? '',
    bankName: me.bankName ?? '',
    docCity: me.docCity ?? '',
    vatPayer: me.vatPayer,
    vatId: me.vatId ?? '',
    taxGroup: me.taxGroup == null ? '' : String(me.taxGroup),
    taxRate: me.taxRate == null ? '' : String(me.taxRate),
    actNumberFormat: me.actNumberFormat,
    payoutCard: me.payoutCard ? me.payoutCard.replace(/(.{4})(?=.)/g, '$1 ') : '',
    payoutLink: me.payoutLink ?? '',
  };
}

/**
 * «Налаштування» (V217): the document requisites — moved here from «Редагувати профіль» — and where a
 * client pays. Both are details the master fills once, rather than who he is, and they meet in the
 * portal's NBU payment QR, which is built from the IBAN and РНОКПП above it.
 *
 * <p>Saved on its own endpoint, never with the profile, so neither form can blank the other. The
 * document numbers only warn (a half-filled form saves); the card and the link are where a client
 * sends money, so the server refuses a card failing Luhn or a link that is not https.</p>
 */
export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const update = useUpdateRequisites();
  const [form, setForm] = useState<SettingsState | null>(null);

  // Seed once per open: saving primes the ['me'] cache, and re-seeding then would wipe an edit.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!open) {
      seededRef.current = false;
      return;
    }
    if (me && !seededRef.current) {
      setForm(seeded(me));
      seededRef.current = true;
    }
  }, [open, me]);

  const set =
    (key: keyof SettingsState) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => (f ? { ...f, [key]: e.target.value } : f));

  const onSave = async () => {
    if (!form) return;
    try {
      await update.mutateAsync({
        // Empty strings clear the field server-side; numeric fields go as null when blank.
        legalName: form.legalName.trim(),
        taxId: form.taxId.trim(),
        legalAddress: form.legalAddress.trim(),
        iban: form.iban.trim(),
        bankName: form.bankName.trim(),
        docCity: form.docCity.trim(),
        vatPayer: form.vatPayer,
        vatId: form.vatId.trim(),
        taxGroup: form.taxGroup.trim() === '' ? null : Number(form.taxGroup),
        taxRate: form.taxRate.trim() === '' ? null : Number(form.taxRate),
        actNumberFormat: form.actNumberFormat,
        payoutCard: form.payoutCard.trim(),
        payoutLink: form.payoutLink.trim(),
      });
      toast.success(t('settings.saved'));
      onClose();
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const cardWarn = form ? cardWarning(form.payoutCard) : null;
  const linkWarn = form ? linkWarning(form.payoutLink) : null;
  const qrReady = form ? form.iban.trim() !== '' && form.taxId.trim() !== '' : false;

  return (
    <Modal open={open} onClose={onClose} title={t('settings.title')}>
      {form && (
        <div className="ph-mask space-y-5">
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-primary">{t('profile.requisites.title')}</h3>
              <p className="text-xs text-muted">{t('settings.requisitesSub')}</p>
            </div>
            <FormField label={t('profile.requisites.legalName')} hint={t('profile.requisites.legalNameHint')}>
              <Input value={form.legalName} onChange={set('legalName')} />
            </FormField>
            <FormField
              label={t('profile.requisites.rnokpp')}
              hint={rnokppWarning(form.taxId) ? undefined : t('profile.requisites.rnokppHint')}
              error={rnokppWarning(form.taxId) ? t(rnokppWarning(form.taxId) as string) : undefined}
            >
              <Input inputMode="numeric" value={form.taxId} onChange={set('taxId')} />
            </FormField>
            <FormField label={t('profile.requisites.legalAddress')}>
              <Input value={form.legalAddress} onChange={set('legalAddress')} />
            </FormField>
            <FormField label={t('profile.requisites.iban')}>
              <Input value={form.iban} onChange={set('iban')} placeholder="UA…" />
            </FormField>
            <FormField label={t('profile.requisites.bankName')}>
              <Input value={form.bankName} onChange={set('bankName')} />
            </FormField>
            <FormField label={t('profile.requisites.docCity')} hint={t('profile.requisites.docCityHint')}>
              <Input value={form.docCity} onChange={set('docCity')} />
            </FormField>
            <FormField label={t('profile.requisites.actNumberFormat')}>
              <Select value={form.actNumberFormat} onChange={set('actNumberFormat')}>
                <option value="PLAIN">{t('profile.requisites.actFormatPlain')}</option>
                <option value="WITH_YEAR">{t('profile.requisites.actFormatWithYear')}</option>
              </Select>
            </FormField>
            <Checkbox
              label={t('profile.requisites.vatPayer')}
              checked={form.vatPayer}
              onChange={() => setForm((f) => (f ? { ...f, vatPayer: !f.vatPayer } : f))}
            />
            {form.vatPayer ? (
              <FormField
                label={t('profile.requisites.vatId')}
                hint={vatIdWarning(form.vatId) ? undefined : t('profile.requisites.vatIdHint')}
                error={vatIdWarning(form.vatId) ? t(vatIdWarning(form.vatId) as string) : undefined}
              >
                <Input inputMode="numeric" value={form.vatId} onChange={set('vatId')} />
              </FormField>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <FormField label={t('profile.requisites.taxGroup')}>
                  <Input inputMode="numeric" value={form.taxGroup} onChange={set('taxGroup')} placeholder="2 / 3" />
                </FormField>
                <FormField label={t('profile.requisites.taxRate')}>
                  <Input inputMode="decimal" value={form.taxRate} onChange={set('taxRate')} placeholder="5" />
                </FormField>
              </div>
            )}
          </section>

          <section className="space-y-3 border-t border-border pt-4">
            <div>
              <h3 className="text-sm font-semibold text-primary">{t('settings.payTitle')}</h3>
              <p className="text-xs text-muted">{t('settings.paySub')}</p>
            </div>
            <FormField
              label={t('settings.payoutCard')}
              hint={cardWarn ? undefined : t('settings.payoutCardHint')}
              error={cardWarn ? t(cardWarn) : undefined}
            >
              <Input
                inputMode="numeric"
                autoComplete="off"
                value={form.payoutCard}
                onChange={set('payoutCard')}
                placeholder="0000 0000 0000 0000"
              />
            </FormField>
            <FormField
              label={t('settings.payoutLink')}
              hint={linkWarn ? undefined : t('settings.payoutLinkHint')}
              error={linkWarn ? t(linkWarn) : undefined}
            >
              <Input
                type="url"
                inputMode="url"
                autoComplete="off"
                value={form.payoutLink}
                onChange={set('payoutLink')}
                placeholder="https://…"
              />
            </FormField>
            <p className="rounded-lg bg-surface-sunken px-3 py-2 text-xs text-secondary">
              {qrReady ? t('settings.qrReady') : t('settings.qrNeeds')}
            </p>
          </section>

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" fullWidth onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button fullWidth loading={update.isPending} onClick={() => void onSave()}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
