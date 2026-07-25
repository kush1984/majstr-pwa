import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { FormField } from '@/components/FormField.tsx';
import { useLogin } from './useLogin.ts';
import { loginSchema, type LoginFormValues } from './loginSchema.ts';
import { toAppError } from '@/api/errors.ts';
import { toast } from '@/hooks/useToast.ts';
import { routes } from '@/lib/config.ts';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const login = useLogin();
  // Prefill the email when arriving from the "already registered → log in" shortcut.
  const prefillEmail = (location.state as { email?: string } | null)?.email ?? '';
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: prefillEmail, password: '' },
  });

  useEffect(() => {
    if (login.isSuccess) {
      void navigate(routes.home, { replace: true });
    }
  }, [login.isSuccess, navigate]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
    } catch (err) {
      const e = toAppError(err);
      // 429 is a likely user-facing case from the backend login rate limit.
      if (e.status === 429) {
        const retry = e.retryAfterSeconds
          ? t('auth.retryAfter', { seconds: e.retryAfterSeconds })
          : '';
        toast.error(t('auth.tooManyAttempts', { retry }));
      } else if (e.status === 401) {
        toast.error(t('auth.wrongCredentials'));
      } else {
        toast.error(e.message);
      }
    }
  });

  return (
    <AuthShell title={t('auth.loginTitle')}>
      <form noValidate onSubmit={onSubmit} className="space-y-4">
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

        <FormField label={t('auth.password')} htmlFor="password" error={errors.password?.message}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            invalid={Boolean(errors.password)}
            {...register('password')}
          />
        </FormField>

        <Button type="submit" fullWidth loading={isSubmitting || login.isPending}>
          {t('auth.signIn')}
        </Button>

        <p className="text-center text-sm text-gray-600">
          {t('auth.noAccount')}{' '}
          <Link to={routes.register} className="font-medium text-brand-700 hover:underline">
            {t('auth.registerLink')}
          </Link>
        </p>

        <p className="text-center text-sm">
          <Link to={routes.forgotPassword} className="text-gray-500 hover:underline">
            {t('auth.forgotPassword')}
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

interface AuthShellProps {
  title: string;
  children: React.ReactNode;
}

export function AuthShell({ title, children }: AuthShellProps) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-2xl font-bold text-white">
            M
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">{children}</div>
      </div>
    </div>
  );
}
