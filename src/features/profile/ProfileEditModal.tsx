import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Checkbox } from '@/components/Checkbox.tsx';
import { FormField } from '@/components/FormField.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { TRADE_VALUES } from '@/features/auth/registerSchema.ts';
import { CUSTOM_TRADE_EMOJI } from '@/lib/labels.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { useAddCustomTrade, useDeleteCustomTrade, useRenameCustomTrade, useUpdateProfile, useUpdateRegion } from './useProfile.ts';
import { regionOptions } from '@/features/region/regionOptions.ts';
import type { Region, Trade } from '@/api/types.ts';
import { Select } from '@/components/Select.tsx';

interface FormState {
  fullName: string;
  phone: string;
  companyName: string;
  email: string;
}

/**
 * Edit the contractor's own profile (#16). Name / phone / company / trades are
 * always editable, and since V190 none of the first three is required: registration no longer asks
 * for them, and a master must be able to save a trade before he has given a name (the first document
 * asks for it — `SenderGate`). Email is conditional: editable only while it's **unverified**
 * (the master may have mistyped it at registration) — changing it triggers a
 * fresh verification email on the backend; once verified it's read-only.
 *
 * <p>An ADDED trade fills its starter catalog server-side, unasked. This screen used to ask «додати
 * набір?», and «Не зараз» left the trade's bundles in the picker with every line at 0 ₴.</p>
 */
export function ProfileEditModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const update = useUpdateProfile();
  const addCustomTrade = useAddCustomTrade();
  const renameCustomTrade = useRenameCustomTrade();
  const deleteCustomTrade = useDeleteCustomTrade();
  const emailEditable = me ? me.emailVerified === false : false;

  const [form, setForm] = useState<FormState>({ fullName: '', phone: '', companyName: '', email: '' });
  const [trades, setTrades] = useState<Trade[]>([]);
  // Where he works (V219) — saved by its own call, after the profile, only when it changed.
  const [region, setRegion] = useState<Region | ''>('');
  const updateRegion = useUpdateRegion();
  const [errors, setErrors] = useState<{
    fullName?: boolean;
    phone?: boolean;
    email?: boolean;
  }>({});
  // Optional until first given, then it may change but not go (V190 review): documents may already
  // carry it, and the backend refuses the erase (400 PROFILE_NAME_REQUIRED).
  const nameLocked = Boolean(me?.fullName?.trim());

  // Custom trades are saved instantly (their own endpoint), independent of the
  // "Зберегti"/save-profile flow below — same reasoning as the logo upload.
  const [addingCustomTrade, setAddingCustomTrade] = useState(false);
  const [newCustomTradeName, setNewCustomTradeName] = useState('');
  const [renamingTradeId, setRenamingTradeId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingTradeId, setDeletingTradeId] = useState<string | null>(null);

  // Seed the form ONCE per open (when `me` is first available), not on every `me`
  // change. Saving the profile primes + invalidates the `['me']` cache, so `me`
  // changes right after save — without this guard that re-fires the effect and
  // wipes any in-progress edit.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!open) {
      seededRef.current = false;
      return;
    }
    if (me && !seededRef.current) {
      setForm({
        fullName: me.fullName ?? '', phone: me.phone ?? '', companyName: me.companyName ?? '', email: me.email,
      });
      setTrades(me.trades);
      setRegion(me.region ?? '');
      setErrors({});
      seededRef.current = true;
    }
  }, [open, me]);

  const set =
    (key: keyof FormState) => (e: ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const toggleTrade = (v: Trade) =>
    setTrades((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  const onSave = async () => {
    // Nothing here is required any more — only a phone that was typed must look like one.
    const phone = form.phone.trim();
    const next = {
      fullName: nameLocked && !form.fullName.trim(),
      phone: phone.length > 0 && phone.length < 5,
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
      if (region && region !== me?.region) await updateRegion.mutateAsync(region);
      toast.success(t('profile.saved'));
      if (emailChanged) toast.info(t('profile.emailChangedSent'));
      // Removing a trade never touches the catalog (the master's data) — just a
      // quiet note that those items remain.
      if (removedTrades.length > 0) toast.info(t('profile.tradeRemovedNote'));
      // The server already filled the new trades' starter catalog — just say so.
      if (addedTrades.length > 0) {
        toast.info(t('profile.tradeSetAddedAuto', {
          trades: addedTrades.map((tr) => t('trades.' + tr)).join(', '),
        }));
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

  const onAddCustomTrade = async () => {
    const name = newCustomTradeName.trim();
    if (!name) return;
    try {
      await addCustomTrade.mutateAsync(name);
      toast.success(t('profile.customTradeAdded'));
      setAddingCustomTrade(false);
      setNewCustomTradeName('');
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const onConfirmRename = async (id: string) => {
    const name = renameValue.trim();
    if (!name) return;
    try {
      await renameCustomTrade.mutateAsync({ id, name });
      toast.success(t('profile.customTradeRenamed'));
      setRenamingTradeId(null);
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const onDeleteCustomTrade = async () => {
    if (!deletingTradeId) return;
    try {
      await deleteCustomTrade.mutateAsync(deletingTradeId);
      toast.success(t('profile.customTradeDeleted'));
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setDeletingTradeId(null);
    }
  };

  return (
    <>
    <Modal open={open} onClose={onClose} title={t('profile.editTitle')}>
      <div className="ph-mask space-y-4">
        <FormField
          label={t('common.fullName')}
          required={nameLocked}
          hint={errors.fullName ? undefined : t('profile.fullNameHint')}
          error={errors.fullName ? t('profile.nameLocked') : undefined}
        >
          <Input value={form.fullName} onChange={set('fullName')} autoComplete="name" invalid={errors.fullName} />
        </FormField>

        <FormField
          label={t('common.phone')}
          hint={errors.phone ? undefined : t('profile.phoneHint')}
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

        <FormField label={t('auth.companyName')} hint={t('profile.companyNameHint')}>
          <Input value={form.companyName} onChange={set('companyName')} autoComplete="organization" />
        </FormField>

        <FormField label={t('region.label')} htmlFor="profile-region">
          <Select id="profile-region" value={region} onChange={(e) => setRegion(e.target.value as Region | '')}>
            <option value="">{t('region.pick')}</option>
            {regionOptions(t).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
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
        </fieldset>

        <fieldset>
          <legend className="mb-1 block text-sm font-medium text-gray-700">
            {t('profile.customTradesTitle')}
          </legend>
          <div className="space-y-1.5">
            {(me?.customTrades ?? []).map((ct) =>
              renamingTradeId === ct.id ? (
                <div key={ct.id} className="flex items-center gap-1.5">
                  <Input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    variant="secondary"
                    loading={renameCustomTrade.isPending}
                    onClick={() => void onConfirmRename(ct.id)}
                  >
                    {t('common.save')}
                  </Button>
                  <Button variant="ghost" onClick={() => setRenamingTradeId(null)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              ) : (
                <div
                  key={ct.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                >
                  <span className="truncate">
                    {CUSTOM_TRADE_EMOJI} {ct.name}
                  </span>
                  <div className="flex flex-shrink-0 items-center gap-3">
                    <button
                      type="button"
                      className="text-xs font-semibold text-brand"
                      onClick={() => {
                        setRenamingTradeId(ct.id);
                        setRenameValue(ct.name);
                      }}
                    >
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      className="text-xs font-semibold text-danger"
                      onClick={() => setDeletingTradeId(ct.id)}
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>

          {addingCustomTrade ? (
            <div className="mt-2 space-y-1.5">
              <Input
                autoFocus
                placeholder={t('profile.customTradeNamePlaceholder')}
                value={newCustomTradeName}
                onChange={(e) => setNewCustomTradeName(e.target.value)}
              />
              <p className="text-xs text-muted">{t('profile.customTradeHonestNote')}</p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  fullWidth
                  onClick={() => {
                    setAddingCustomTrade(false);
                    setNewCustomTradeName('');
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button fullWidth loading={addCustomTrade.isPending} onClick={() => void onAddCustomTrade()}>
                  {t('common.add')}
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="mt-2 text-sm font-semibold text-brand"
              onClick={() => setAddingCustomTrade(true)}
            >
              {t('profile.addCustomTrade')}
            </button>
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
    </Modal>

    <ConfirmDialog
      open={deletingTradeId !== null}
      title={t('profile.customTradeDeleteTitle')}
      message={t('profile.customTradeDeleteMessage')}
      loading={deleteCustomTrade.isPending}
      onConfirm={() => void onDeleteCustomTrade()}
      onClose={() => setDeletingTradeId(null)}
    />
    </>
  );
}
