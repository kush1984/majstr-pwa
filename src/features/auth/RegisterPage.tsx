import { useEffect, useRef, useState } from 'react';
import { clearSessionDrafts, readSessionDraft, writeSessionDraft } from '@/lib/sessionDraft.ts';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Checkbox } from '@/components/Checkbox.tsx';
import { FormField } from '@/components/FormField.tsx';
import { CUSTOM_TRADE_EMOJI } from '@/lib/labels.ts';
import { useRegister } from './useRegister.ts';
import {
  registerSchema,
  TRADE_VALUES,
  type RegisterFormValues,
} from './registerSchema.ts';
import { AuthShell } from './LoginPage.tsx';
import { toAppError } from '@/api/errors.ts';
import { toast } from '@/hooks/useToast.ts';
import { routes } from '@/lib/config.ts';
import { getStoredFirstTouch, getStoredRef, getStoredUtm } from '@/lib/referral.ts';

const REGISTER_DRAFT = 'register';
type RegisterDraft = Partial<Omit<RegisterFormValues, 'password' | 'consent'>>;

export function RegisterPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const register$ = useRegister();
  const [emailTaken, setEmailTaken] = useState(false);
  // Custom trade names are collected locally and created alongside the account on submit —
  // there's no user yet to attach them to individually (unlike ProfileEditModal, which saves
  // each one instantly through its own endpoint).
  // The half-filled form survives a reload (review P1-2) — everything but the password and consent.
  const [draft] = useState(() => readSessionDraft<RegisterDraft>(REGISTER_DRAFT));
  const [customTrades, setCustomTrades] = useState<string[]>(draft?.customTrades ?? []);
  const [addingCustomTrade, setAddingCustomTrade] = useState(false);
  const [newCustomTradeName, setNewCustomTradeName] = useState('');
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    getValues,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: draft?.email ?? '',
      password: '',
      fullName: draft?.fullName ?? '',
      trades: draft?.trades ?? [],
      customTrades: draft?.customTrades ?? [],
      phone: draft?.phone ?? '',
      companyName: draft?.companyName ?? '',
      consent: false,
      promoCode: draft?.promoCode ?? '',
    },
  });

  useEffect(() => {
    const sub = watch((v) => writeSessionDraft(REGISTER_DRAFT, {
      email: v.email, fullName: v.fullName, phone: v.phone, companyName: v.companyName,
      trades: v.trades, customTrades: v.customTrades, promoCode: v.promoCode,
    }));
    return () => sub.unsubscribe();
  }, [watch]);

  // «Назва компанії» follows the name until the master types his own (review P1-16): most register
  // as themselves, and a sixth required field to retype the same words was a step on the way in.
  // The documents already print whatever is here, so his name is what they show — as before, when
  // he typed it himself.
  const companyEdited = useRef(Boolean(draft?.companyName && draft.companyName !== draft.fullName));
  const fullNameField = register('fullName', {
    onChange: (e: { target: { value: string } }) => {
      if (!companyEdited.current) setValue('companyName', e.target.value);
    },
  });
  const companyField = register('companyName', {
    onChange: () => { companyEdited.current = true; },
  });

  const syncCustomTrades = (next: string[]) => {
    setCustomTrades(next);
    setValue('customTrades', next, { shouldValidate: true });
  };

  const onAddCustomTrade = () => {
    const name = newCustomTradeName.trim();
    if (!name || customTrades.some((t) => t.toLowerCase() === name.toLowerCase())) {
      setNewCustomTradeName('');
      setAddingCustomTrade(false);
      return;
    }
    syncCustomTrades([...customTrades, name]);
    setNewCustomTradeName('');
    setAddingCustomTrade(false);
  };

  const onRemoveCustomTrade = (name: string) =>
    syncCustomTrades(customTrades.filter((t) => t !== name));

  useEffect(() => {
    if (register$.isSuccess) {
      clearSessionDrafts(REGISTER_DRAFT);
      void navigate(routes.home, { replace: true });
    }
  }, [register$.isSuccess, navigate]);

  const onSubmit = handleSubmit(async (values) => {
    setEmailTaken(false);
    try {
      await register$.mutateAsync({
        ...values,
        trades: values.trades,
        customTrades: values.customTrades.length > 0 ? values.customTrades : undefined,
        // First-touch attribution: the stored ?ref= wins, the typed promo code is
        // a fallback. Absent → the backend attributes DIRECT.
        ref: getStoredRef(),
        promoCode: values.promoCode?.trim() || undefined,
        // The channel dimension, stamped once server-side alongside the source above.
        ...getStoredUtm(),
        // …and where he came from and landed first (V178) — search sets no UTM.
        ...getStoredFirstTouch(),
      });
    } catch (err) {
      const e = toAppError(err);
      if (e.code === 'EMAIL_ALREADY_REGISTERED' || e.status === 409) {
        // Dup email — show a clear field error + a "log in" shortcut (email prefilled).
        setError('email', { message: t('auth.emailAlreadyRegistered') });
        setEmailTaken(true);
      } else if (e.code === 'EMAIL_DOMAIN_BLOCKED') {
        // Disposable / non-mail domain — inline under the email field (server message is localized).
        setError('email', { message: e.message });
      } else if (e.status === 400) {
        toast.error(e.message); // server-side validation details
      } else {
        toast.error(e.message);
      }
    }
  });

  const goToLogin = () =>
    void navigate(routes.login, { state: { email: getValues('email').trim().toLowerCase() } });

  return (
    <AuthShell title={t('auth.registerTitle')}>
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        <FormField label={t('common.email')} htmlFor="email" required error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            invalid={Boolean(errors.email)}
            {...register('email')}
          />
          {emailTaken && (
            <button
              type="button"
              onClick={goToLogin}
              className="mt-1.5 text-sm font-semibold text-brand underline"
            >
              {t('auth.emailTakenLogin')}
            </button>
          )}
        </FormField>

        <FormField label={t('auth.password')} htmlFor="password" required error={errors.password?.message} hint={t('auth.passwordHint')}>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            invalid={Boolean(errors.password)}
            {...register('password')}
          />
        </FormField>

        <FormField label={t('common.fullName')} htmlFor="fullName" required error={errors.fullName?.message}>
          <Input
            id="fullName"
            autoComplete="name"
            invalid={Boolean(errors.fullName)}
            {...fullNameField}
          />
        </FormField>

        <fieldset>
          <legend className="mb-1 block text-sm font-medium text-gray-700">
            {t('auth.tradeType')}
            <span className="ml-0.5 text-red-500" aria-hidden>*</span>
            <span className="ml-2 font-normal text-gray-500">{t('auth.chooseSeveral')}</span>
          </legend>
          {/* Two columns from the narrowest phone up (review P1-16): eleven trades in one column were
              a whole screen of scrolling before the account even existed. */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {TRADE_VALUES.map((value) => (
              <Checkbox
                key={value}
                value={value}
                label={t('trades.' + value)}
                {...register('trades')}
              />
            ))}
          </div>
          {errors.trades && (
            <span className="mt-1 block text-xs text-red-600">{errors.trades.message}</span>
          )}
        </fieldset>

        <fieldset>
          <legend className="mb-1 block text-sm font-medium text-gray-700">
            {t('profile.customTradesTitle')}
          </legend>
          {customTrades.length > 0 && (
            <div className="space-y-1.5">
              {customTrades.map((name) => (
                <div
                  key={name}
                  className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                >
                  <span className="truncate">
                    {CUSTOM_TRADE_EMOJI} {name}
                  </span>
                  <button
                    type="button"
                    className="flex-shrink-0 text-xs font-semibold text-danger"
                    onClick={() => onRemoveCustomTrade(name)}
                  >
                    {t('common.delete')}
                  </button>
                </div>
              ))}
            </div>
          )}
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
                  type="button"
                  variant="secondary"
                  fullWidth
                  onClick={() => {
                    setAddingCustomTrade(false);
                    setNewCustomTradeName('');
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button type="button" fullWidth onClick={onAddCustomTrade}>
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

        <FormField label={t('common.phone')} htmlFor="phone" required error={errors.phone?.message}>
          <Input
            id="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder={t('auth.phonePlaceholder')}
            invalid={Boolean(errors.phone)}
            {...register('phone')}
          />
        </FormField>

        <FormField label={t('auth.companyName')} htmlFor="companyName" required error={errors.companyName?.message}
          hint={t('auth.companyNameHint')}>
          <Input
            id="companyName"
            autoComplete="organization"
            invalid={Boolean(errors.companyName)}
            {...companyField}
          />
        </FormField>

        <details className="text-sm">
          <summary className="cursor-pointer text-gray-600">{t('auth.havePromo')}</summary>
          <div className="mt-2">
            <FormField label={t('auth.promoCode')} htmlFor="promoCode" error={errors.promoCode?.message}>
              <Input
                id="promoCode"
                autoComplete="off"
                placeholder={t('auth.promoPlaceholder')}
                invalid={Boolean(errors.promoCode)}
                {...register('promoCode')}
              />
            </FormField>
          </div>
        </details>

        <div>
          <label className="flex items-start gap-2.5 text-sm text-gray-700">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-border text-brand focus:ring-brand"
              {...register('consent')}
            />
            <span>
              {t('consent.registerPre')}
              <Link
                to={routes.privacy}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-brand-700 underline"
              >
                {t('consent.privacyLink')}
              </Link>
              {t('consent.registerPost')}
            </span>
          </label>
          {errors.consent && (
            <span className="mt-1 block text-xs text-red-600">{errors.consent.message}</span>
          )}
        </div>

        <Button type="submit" fullWidth loading={isSubmitting || register$.isPending}>
          {t('auth.signUp')}
        </Button>

        <p className="text-center text-sm text-gray-600">
          {t('auth.haveAccount')}{' '}
          <Link to={routes.login} className="font-medium text-brand-700 hover:underline">
            {t('auth.signIn')}
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
