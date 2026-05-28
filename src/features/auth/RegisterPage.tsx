import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Select } from '@/components/Select.tsx';
import { FormField } from '@/components/FormField.tsx';
import { useRegister } from './useRegister.ts';
import {
  registerSchema,
  TRADE_OPTIONS,
  type RegisterFormValues,
} from './registerSchema.ts';
import { AuthShell } from './LoginPage.tsx';
import { toAppError } from '@/api/errors.ts';
import { toast } from '@/hooks/useToast.ts';
import { routes } from '@/lib/config.ts';
import type { Trade } from '@/api/types.ts';

export function RegisterPage() {
  const navigate = useNavigate();
  const register$ = useRegister();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      password: '',
      fullName: '',
      trade: '' as unknown as Trade,
      phone: '',
      companyName: '',
    },
  });

  useEffect(() => {
    if (register$.isSuccess) {
      navigate(routes.dashboard, { replace: true });
    }
  }, [register$.isSuccess, navigate]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await register$.mutateAsync({
        ...values,
        trade: values.trade as Trade,
      });
    } catch (err) {
      const e = toAppError(err);
      if (e.status === 409) {
        // Backend returns "Email is already registered: foo@example.com"
        setError('email', { message: 'Цей email вже зареєстрований' });
      } else if (e.status === 400) {
        toast.error(e.message); // server-side validation details
      } else {
        toast.error(e.message);
      }
    }
  });

  return (
    <AuthShell title="Реєстрація">
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        <FormField label="Email" htmlFor="email" required error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            invalid={Boolean(errors.email)}
            {...register('email')}
          />
        </FormField>

        <FormField label="Пароль" htmlFor="password" required error={errors.password?.message} hint="Мінімум 8 символів">
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            invalid={Boolean(errors.password)}
            {...register('password')}
          />
        </FormField>

        <FormField label="Ім'я та прізвище" htmlFor="fullName" required error={errors.fullName?.message}>
          <Input
            id="fullName"
            autoComplete="name"
            invalid={Boolean(errors.fullName)}
            {...register('fullName')}
          />
        </FormField>

        <FormField label="Тип робіт" htmlFor="trade" required error={errors.trade?.message}>
          <Select id="trade" invalid={Boolean(errors.trade)} defaultValue="" {...register('trade')}>
            <option value="" disabled>Оберіть зі списку</option>
            {TRADE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </FormField>

        <FormField label="Телефон" htmlFor="phone" required error={errors.phone?.message}>
          <Input
            id="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder="+380..."
            invalid={Boolean(errors.phone)}
            {...register('phone')}
          />
        </FormField>

        <FormField label="Назва компанії" htmlFor="companyName" required error={errors.companyName?.message}>
          <Input
            id="companyName"
            autoComplete="organization"
            invalid={Boolean(errors.companyName)}
            {...register('companyName')}
          />
        </FormField>

        <Button type="submit" fullWidth loading={isSubmitting || register$.isPending}>
          Створити акаунт
        </Button>

        <p className="text-center text-sm text-gray-600">
          Уже зареєстровані?{' '}
          <Link to={routes.login} className="font-medium text-brand-700 hover:underline">
            Увійти
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
