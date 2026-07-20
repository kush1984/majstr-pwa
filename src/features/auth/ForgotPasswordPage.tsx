import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
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

const schema = z.object({
  email: z.string().min(1, i18n.t('validation.enterEmail')).email(i18n.t('validation.invalidEmail')),
});
type Values = z.infer<typeof schema>;

/**
 * "Forgot password" — public. Submitting always lands on the same neutral "check your
 * email" screen whether or not the account exists (the backend answers a neutral 200),
 * so this page never reveals which addresses are registered.
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  const onSubmit = handleSubmit(async ({ email }) => {
    try {
      await authApi.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      const e = toAppError(err);
      // A 429 is anti-spam feedback, not account existence — surface it, keep others generic.
      toast.error(e.status === 429 ? t('reset.tooMany') : e.message);
    }
  });

  if (sent) {
    return (
      <AuthShell title={t('reset.checkEmailTitle')}>
        <p className="text-sm text-gray-600">{t('reset.checkEmailText')}</p>
        <Link
          to={routes.login}
          className="mt-6 block text-center text-sm font-medium text-brand-700 hover:underline"
        >
          {t('reset.backToLogin')}
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('reset.forgotTitle')}>
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        <p className="text-sm text-gray-600">{t('reset.forgotText')}</p>
        <FormField label={t('common.email')} htmlFor="email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            invalid={Boolean(errors.email)}
            {...register('email')}
          />
        </FormField>
        <Button type="submit" fullWidth loading={isSubmitting}>
          {t('reset.sendLink')}
        </Button>
        <p className="text-center text-sm">
          <Link to={routes.login} className="text-gray-500 hover:underline">
            {t('reset.backToLogin')}
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
