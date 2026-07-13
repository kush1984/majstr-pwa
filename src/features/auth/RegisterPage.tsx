import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Checkbox } from '@/components/Checkbox.tsx';
import { FormField } from '@/components/FormField.tsx';
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
import { getStoredRef } from '@/lib/referral.ts';
import type { Trade } from '@/api/types.ts';

export function RegisterPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const register$ = useRegister();
  const [emailTaken, setEmailTaken] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      password: '',
      fullName: '',
      trades: [],
      phone: '',
      companyName: '',
      consent: false,
      promoCode: '',
    },
  });

  useEffect(() => {
    if (register$.isSuccess) {
      navigate(routes.home, { replace: true });
    }
  }, [register$.isSuccess, navigate]);

  const onSubmit = handleSubmit(async (values) => {
    setEmailTaken(false);
    try {
      await register$.mutateAsync({
        ...values,
        trades: values.trades as Trade[],
        // First-touch attribution: the stored ?ref= wins, the typed promo code is
        // a fallback. Absent → the backend attributes DIRECT.
        ref: getStoredRef(),
        promoCode: values.promoCode?.trim() || undefined,
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
    navigate(routes.login, { state: { email: getValues('email').trim().toLowerCase() } });

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
            {...register('fullName')}
          />
        </FormField>

        <fieldset>
          <legend className="mb-1 block text-sm font-medium text-gray-700">
            {t('auth.tradeType')}
            <span className="ml-0.5 text-red-500" aria-hidden>*</span>
            <span className="ml-2 font-normal text-gray-500">{t('auth.chooseSeveral')}</span>
          </legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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

        <FormField label={t('auth.companyName')} htmlFor="companyName" required error={errors.companyName?.message}>
          <Input
            id="companyName"
            autoComplete="organization"
            invalid={Boolean(errors.companyName)}
            {...register('companyName')}
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
