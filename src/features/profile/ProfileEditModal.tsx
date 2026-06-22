import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Checkbox } from '@/components/Checkbox.tsx';
import { FormField } from '@/components/FormField.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { TRADE_VALUES } from '@/features/auth/registerSchema.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { useAddCatalogTemplates } from '@/features/catalog/useCatalog.ts';
import { useUpdateProfile } from './useProfile.ts';
import type { Trade } from '@/api/types.ts';

interface FormState {
  fullName: string;
  phone: string;
  companyName: string;
  email: string;
}

/**
 * Edit the contractor's own profile (#16). Name / phone / company / trades are
 * always editable. Email is conditional: editable only while it's **unverified**
 * (the master may have mistyped it at registration) — changing it triggers a
 * fresh verification email on the backend; once verified it's read-only.
 */
export function ProfileEditModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const update = useUpdateProfile();
  const addTemplates = useAddCatalogTemplates();
  const emailEditable = me ? me.emailVerified === false : false;

  const [form, setForm] = useState<FormState>({ fullName: '', phone: '', companyName: '', email: '' });
  const [trades, setTrades] = useState<Trade[]>([]);
  // After saving, if the user ADDED a trade we offer (with consent) to merge its
  // starter set into the catalog. Never auto-add, never delete on trade removal.
  const [addPrompt, setAddPrompt] = useState<Trade[] | null>(null);
  const [errors, setErrors] = useState<{
    fullName?: boolean;
    phone?: boolean;
    companyName?: boolean;
    trades?: boolean;
    email?: boolean;
  }>({});

  // Seed the form ONCE per open (when `me` is first available), not on every `me`
  // change. Saving the profile primes + invalidates the `['me']` cache, so `me`
  // changes right after save — without this guard that re-fires the effect and
  // wipes the "add starter set?" prompt (and any in-progress edit) before it shows.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!open) {
      seededRef.current = false;
      return;
    }
    if (me && !seededRef.current) {
      setForm({ fullName: me.fullName, phone: me.phone, companyName: me.companyName, email: me.email });
      setTrades(me.trades);
      setErrors({});
      setAddPrompt(null);
      seededRef.current = true;
    }
  }, [open, me]);

  const set =
    (key: keyof FormState) => (e: ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const toggleTrade = (v: Trade) =>
    setTrades((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  const onSave = async () => {
    const next = {
      fullName: !form.fullName.trim(),
      phone: form.phone.trim().length < 5,
      companyName: !form.companyName.trim(),
      trades: trades.length === 0,
      email: emailEditable && !form.email.includes('@'),
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;

    const emailChanged = emailEditable && form.email.trim() !== me?.email;
    const previous = me?.trades ?? [];
    const addedTrades = trades.filter((tr) => !previous.includes(tr));
    const removedTrades = previous.filter((tr) => !trades.includes(tr));
    try {
      await update.mutateAsync({
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        companyName: form.companyName.trim(),
        trades,
        ...(emailEditable ? { email: form.email.trim() } : {}),
      });
      toast.success(t('profile.saved'));
      if (emailChanged) toast.info(t('profile.emailChangedSent'));
      // Removing a trade never touches the catalog (the master's data) — just a
      // quiet note that those items remain.
      if (removedTrades.length > 0) toast.info(t('profile.tradeRemovedNote'));
      if (addedTrades.length > 0) {
        setAddPrompt(addedTrades); // keep the modal open to offer the starter set
        return;
      }
      onClose();
    } catch (err) {
      const e = toAppError(err);
      if (e.code === 'EMAIL_ALREADY_VERIFIED') {
        toast.error(t('profile.emailAlreadyVerified'));
      } else {
        toast.error(e.message);
      }
    }
  };

  const confirmAddSet = async () => {
    if (!addPrompt) return;
    try {
      const res = await addTemplates.mutateAsync(addPrompt);
      toast.success(t('profile.tradeSetAdded', { count: res.itemsAdded }));
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setAddPrompt(null);
      onClose();
    }
  };

  const skipAddSet = () => {
    setAddPrompt(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={addPrompt ? skipAddSet : onClose}
      title={addPrompt ? t('profile.addSetTitle') : t('profile.editTitle')}
    >
      {addPrompt ? (
        <div>
          <p className="mb-5 text-sm text-muted">
            {t('profile.addSetPrompt', {
              trades: addPrompt.map((tr) => t('trades.' + tr)).join(', '),
            })}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={skipAddSet}>
              {t('profile.notNow')}
            </Button>
            <Button fullWidth loading={addTemplates.isPending} onClick={confirmAddSet}>
              {t('profile.addSet')}
            </Button>
          </div>
        </div>
      ) : (
      <div className="space-y-4">
        <FormField
          label={t('common.fullName')}
          required
          error={errors.fullName ? t('validation.enterFullName') : undefined}
        >
          <Input value={form.fullName} onChange={set('fullName')} invalid={errors.fullName} />
        </FormField>

        <FormField
          label={t('common.phone')}
          required
          error={errors.phone ? t('validation.enterPhone') : undefined}
        >
          <Input
            type="tel"
            inputMode="tel"
            value={form.phone}
            onChange={set('phone')}
            invalid={errors.phone}
          />
        </FormField>

        <FormField
          label={t('auth.companyName')}
          required
          error={errors.companyName ? t('validation.enterCompanyName') : undefined}
        >
          <Input value={form.companyName} onChange={set('companyName')} invalid={errors.companyName} />
        </FormField>

        <fieldset>
          <legend className="mb-1 block text-sm font-medium text-gray-700">
            {t('auth.tradeType')}
            <span className="ml-2 font-normal text-gray-500">{t('auth.chooseSeveral')}</span>
          </legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TRADE_VALUES.map((v) => (
              <Checkbox
                key={v}
                label={t('trades.' + v)}
                checked={trades.includes(v)}
                onChange={() => toggleTrade(v)}
              />
            ))}
          </div>
          {errors.trades && (
            <span className="mt-1 block text-xs text-red-600">{t('validation.chooseTrade')}</span>
          )}
        </fieldset>

        {emailEditable ? (
          <FormField
            label={t('common.email')}
            required
            error={errors.email ? t('validation.invalidEmail') : undefined}
            hint={t('profile.emailEditableHint')}
          >
            <Input
              type="email"
              inputMode="email"
              value={form.email}
              onChange={set('email')}
              invalid={errors.email}
            />
          </FormField>
        ) : (
          <FormField label={t('common.email')}>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm text-gray-600">
              <span className="truncate">{me?.email}</span>
              <span className="flex-shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                {t('profile.emailVerifiedBadge')}
              </span>
            </div>
          </FormField>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="secondary" fullWidth onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button fullWidth loading={update.isPending} onClick={onSave}>
            {t('common.save')}
          </Button>
        </div>
      </div>
      )}
    </Modal>
  );
}
