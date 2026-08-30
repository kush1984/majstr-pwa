import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Select } from '@/components/Select.tsx';
import { Checkbox } from '@/components/Checkbox.tsx';
import { FormField } from '@/components/FormField.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { TRADE_VALUES } from '@/features/auth/registerSchema.ts';
import { CUSTOM_TRADE_EMOJI } from '@/lib/labels.ts';
import { rnokppWarning, vatIdWarning } from '@/lib/requisites.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { useAddCatalogTemplates } from '@/features/catalog/useCatalog.ts';
import { useAddCustomTrade, useDeleteCustomTrade, useRenameCustomTrade, useUpdateProfile } from './useProfile.ts';
import type { ActNumberFormat, Trade } from '@/api/types.ts';

interface FormState {
  fullName: string;
  phone: string;
  companyName: string;
  email: string;
}

/** Document-requisite fields (acts iteration). Kept as strings for the inputs; taxGroup/taxRate
 *  are parsed to numbers on save. All optional — the whole block is «потрібні для актів і PDF». */
interface RequisitesState {
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
}

const EMPTY_REQUISITES: RequisitesState = {
  legalName: '', taxId: '', legalAddress: '', iban: '', bankName: '', docCity: '',
  vatPayer: false, vatId: '', taxGroup: '', taxRate: '', actNumberFormat: 'PLAIN',
};

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
  const addCustomTrade = useAddCustomTrade();
  const renameCustomTrade = useRenameCustomTrade();
  const deleteCustomTrade = useDeleteCustomTrade();
  const emailEditable = me ? me.emailVerified === false : false;

  const [form, setForm] = useState<FormState>({ fullName: '', phone: '', companyName: '', email: '' });
  const [trades, setTrades] = useState<Trade[]>([]);
  // Document requisites — collapsed by default (secondary to name/phone/trades), expanded once
  // the master already has some filled in so they don't have to hunt for them.
  const [req, setReq] = useState<RequisitesState>(EMPTY_REQUISITES);
  const [reqOpen, setReqOpen] = useState(false);
  // After saving, if the user ADDED a trade we offer (with consent) to merge its
  // starter set into the catalog. Never auto-add, never delete on trade removal.
  const [addPrompt, setAddPrompt] = useState<Trade[] | null>(null);
  const [errors, setErrors] = useState<{
    fullName?: boolean;
    phone?: boolean;
    companyName?: boolean;
    email?: boolean;
  }>({});

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
      const seededReq: RequisitesState = {
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
      };
      setReq(seededReq);
      // Auto-expand if anything is already filled — otherwise keep it out of the way.
      setReqOpen(Object.values(seededReq).some((v) => v !== '' && v !== false && v !== 'PLAIN'));
      setErrors({});
      setAddPrompt(null);
      seededRef.current = true;
    }
  }, [open, me]);

  const set =
    (key: keyof FormState) => (e: ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const setReqField =
    (key: keyof RequisitesState) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setReq((r) => ({ ...r, [key]: e.target.value }));

  const toggleTrade = (v: Trade) =>
    setTrades((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  const onSave = async () => {
    const next = {
      fullName: !form.fullName.trim(),
      phone: form.phone.trim().length < 5,
      companyName: !form.companyName.trim(),
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
        // Requisites — empty strings clear the field server-side (trimToNull); numeric fields go
        // as null when blank. Warnings never blocked us getting here.
        legalName: req.legalName.trim(),
        taxId: req.taxId.trim(),
        legalAddress: req.legalAddress.trim(),
        iban: req.iban.trim(),
        bankName: req.bankName.trim(),
        docCity: req.docCity.trim(),
        vatPayer: req.vatPayer,
        vatId: req.vatId.trim(),
        taxGroup: req.taxGroup.trim() === '' ? null : Number(req.taxGroup),
        taxRate: req.taxRate.trim() === '' ? null : Number(req.taxRate),
        actNumberFormat: req.actNumberFormat,
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
      <div className="ph-mask space-y-4">
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

        {/* Document requisites — collapsed by default, needed only for acts/PDF. */}
        <div className="rounded-lg border border-gray-200">
          <button
            type="button"
            onClick={() => setReqOpen((o) => !o)}
            aria-expanded={reqOpen}
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
          >
            <span>
              <span className="block text-sm font-medium text-gray-700">{t('profile.requisites.title')}</span>
              <span className="block text-xs text-muted">{t('profile.requisites.subtitle')}</span>
            </span>
            <span className={'text-muted transition-transform ' + (reqOpen ? 'rotate-180' : '')} aria-hidden>▾</span>
          </button>

          {reqOpen && (
            <div className="space-y-3 border-t border-gray-200 px-3 py-3">
              <FormField label={t('profile.requisites.legalName')} hint={t('profile.requisites.legalNameHint')}>
                <Input value={req.legalName} onChange={setReqField('legalName')} />
              </FormField>
              <FormField
                label={t('profile.requisites.rnokpp')}
                hint={rnokppWarning(req.taxId) ? undefined : t('profile.requisites.rnokppHint')}
                error={rnokppWarning(req.taxId) ? t(rnokppWarning(req.taxId) as string) : undefined}
              >
                <Input inputMode="numeric" value={req.taxId} onChange={setReqField('taxId')} />
              </FormField>
              <FormField label={t('profile.requisites.legalAddress')}>
                <Input value={req.legalAddress} onChange={setReqField('legalAddress')} />
              </FormField>
              <FormField label={t('profile.requisites.iban')}>
                <Input value={req.iban} onChange={setReqField('iban')} placeholder="UA…" />
              </FormField>
              <FormField label={t('profile.requisites.bankName')}>
                <Input value={req.bankName} onChange={setReqField('bankName')} />
              </FormField>
              <FormField label={t('profile.requisites.docCity')} hint={t('profile.requisites.docCityHint')}>
                <Input value={req.docCity} onChange={setReqField('docCity')} />
              </FormField>
              <FormField label={t('profile.requisites.actNumberFormat')}>
                <Select value={req.actNumberFormat} onChange={setReqField('actNumberFormat')}>
                  <option value="PLAIN">{t('profile.requisites.actFormatPlain')}</option>
                  <option value="WITH_YEAR">{t('profile.requisites.actFormatWithYear')}</option>
                </Select>
              </FormField>

              <Checkbox
                label={t('profile.requisites.vatPayer')}
                checked={req.vatPayer}
                onChange={() => setReq((r) => ({ ...r, vatPayer: !r.vatPayer }))}
              />
              {req.vatPayer ? (
                <FormField
                  label={t('profile.requisites.vatId')}
                  hint={vatIdWarning(req.vatId) ? undefined : t('profile.requisites.vatIdHint')}
                  error={vatIdWarning(req.vatId) ? t(vatIdWarning(req.vatId) as string) : undefined}
                >
                  <Input inputMode="numeric" value={req.vatId} onChange={setReqField('vatId')} />
                </FormField>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <FormField label={t('profile.requisites.taxGroup')}>
                    <Input inputMode="numeric" value={req.taxGroup} onChange={setReqField('taxGroup')} placeholder="2 / 3" />
                  </FormField>
                  <FormField label={t('profile.requisites.taxRate')}>
                    <Input inputMode="decimal" value={req.taxRate} onChange={setReqField('taxRate')} placeholder="5" />
                  </FormField>
                </div>
              )}
            </div>
          )}
        </div>

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
