import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { FormField } from '@/components/FormField.tsx';
import { authApi } from '@/api/auth.ts';
import { toAppError } from '@/api/errors.ts';
import { toast } from '@/hooks/useToast.ts';
import { routes } from '@/lib/config.ts';
import i18n from '@/lib/i18n.ts';
import { AuthShell } from './LoginPage.tsx';

const schema = z
  .object({
    password: z
      .string()
      .min(8, i18n.t('validation.passwordTooShort'))
      .max(100, i18n.t('validation.passwordTooLong')),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: i18n.t('validation.passwordsMismatch'),
  });
type Values = z.infer<typeof schema>;

/**
 * "Reset password" — public landing for the email link (`/reset-password?token=...`).
 * Sets a new password with the same policy as register; on success the master logs in
 * with the new password (no auto-login). A missing/expired/used token → a friendly
 * "link expired" state with a path back to request a fresh one.
 */
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [expired, setExpired] = useState(!token);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });

  const onSubmit = handleSubmit(async ({ password }) => {
    try {
      await authApi.resetPassword(token, password);
      toast.success(t('reset.doneToast'));
      void navigate(routes.login, { replace: true, state: {} });
    } catch (err) {
      const e = toAppError(err);
      // A bad/expired/used token comes back 400 INVALID_OR_EXPIRED_TOKEN — show the
      // dedicated "link expired" screen with a way to request a new one.
      if (e.status === 400 || e.code === 'INVALID_OR_EXPIRED_TOKEN') {
        setExpired(true);
      } else {
        toast.error(e.message);
      }
    }
  });

  if (expired) {
    return (
      <AuthShell title={t('reset.expiredTitle')}>
        <p className="text-sm text-gray-600">{t('reset.expiredText')}</p>
        <Link
          to={routes.forgotPassword}
          className="mt-6 block w-full rounded-lg bg-brand-600 py-2.5 text-center text-sm font-medium text-white hover:bg-brand-700"
        >
          {t('reset.requestNew')}
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('reset.newPasswordTitle')}>
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        <FormField label={t('reset.newPassword')} htmlFor="password" error={errors.password?.message}>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            invalid={Boolean(errors.password)}
            {...register('password')}
          />
        </FormField>
        <FormField label={t('reset.confirmPassword')} htmlFor="confirm" error={errors.confirm?.message}>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            invalid={Boolean(errors.confirm)}
            {...register('confirm')}
          />
        </FormField>
        <Button type="submit" fullWidth loading={isSubmitting}>
          {t('reset.setPassword')}
        </Button>
      </form>
    </AuthShell>
  );
}
