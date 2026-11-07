import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { clearSessionDrafts, readSessionDraft, writeSessionDraft } from '@/lib/sessionDraft.ts';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { FormField } from '@/components/FormField.tsx';
import { useRegister } from './useRegister.ts';
import { registerSchema, type RegisterFormValues } from './registerSchema.ts';
import { AuthShell } from './LoginPage.tsx';
import { toAppError } from '@/api/errors.ts';
import { toast } from '@/hooks/useToast.ts';
import { routes } from '@/lib/config.ts';
import { getStoredFirstTouch, getStoredRef, getStoredUtm } from '@/lib/referral.ts';
import { sendVisit } from '@/lib/visit.ts';
import { suggestEmail } from '@/lib/emailSuggestion.ts';

const REGISTER_DRAFT = 'register';
type RegisterDraft = Partial<Omit<RegisterFormValues, 'password' | 'consent'>>;
/** The form's fields in screen order, as the visit report names them. */
const FORM_FIELDS = ['email', 'password', 'promoCode', 'consent'] as const;

/**
 * The door (V190): email, password, consent — nothing about the person, so nothing to trust us with
 * yet. Trades are asked on the first screen inside (`TradesOnboardingPage`), the name before the first
 * document leaves (`SenderGate`).
 */
export function RegisterPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const register$ = useRegister();
  const [emailTaken, setEmailTaken] = useState(false);
  // «Може, ivan@gmail.com?» — offered when the field is left, cleared as soon as it is edited.
  const [emailHint, setEmailHint] = useState<string | null>(null);
  // The half-filled form survives a reload (review P1-2) — everything but the password and consent.
  const [draft] = useState(() => readSessionDraft<RegisterDraft>(REGISTER_DRAFT));
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    getValues,
    watch,
    formState: { errors, isSubmitting, submitCount },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: draft?.email ?? '',
      password: '',
      consent: false,
      promoCode: draft?.promoCode ?? '',
    },
  });

  useEffect(() => {
    const sub = watch((v) => writeSessionDraft(REGISTER_DRAFT, { email: v.email, promoCode: v.promoCode }));
    return () => sub.unsubscribe();
  }, [watch]);

  const emailField = register('email', {
    onChange: () => setEmailHint(null),
    onBlur: (e: { target: { value: string } }) => setEmailHint(suggestEmail(e.target.value)),
  });
  const applyEmailHint = () => {
    if (!emailHint) return;
    setValue('email', emailHint, { shouldValidate: true, shouldDirty: true });
    setEmailHint(null);
    setEmailTaken(false);
  };

  useEffect(() => {
    if (register$.isSuccess) {
      clearSessionDrafts(REGISTER_DRAFT);
      // Straight to «Чим займаєтесь?» — the account is there, the app is not set up yet.
      void navigate(routes.welcome, { replace: true });
    }
  }, [register$.isSuccess, navigate]);

  const onSubmit = handleSubmit(async (values) => {
    setEmailTaken(false);
    sendVisit('REGISTER_SUBMIT', routes.register);
    try {
      await register$.mutateAsync({
        email: values.email,
        password: values.password,
        consent: values.consent,
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
      sendVisit('REGISTER_ERROR', routes.register, {
        target: `server:${String(e.code ?? e.status ?? 'unknown').toLowerCase()}`,
      });
      if (e.code === 'EMAIL_ALREADY_REGISTERED' || e.status === 409) {
        // Dup email — show a clear field error + a "log in" shortcut (email prefilled).
        showEmailError(t('auth.emailAlreadyRegistered'));
        setEmailTaken(true);
      } else if (e.code === 'EMAIL_NO_MAIL' || e.code === 'EMAIL_DISPOSABLE') {
        // A typo (gmal.com) or a throwaway, in the server's own words, under the field.
        showEmailError(e.message);
        if (e.code === 'EMAIL_NO_MAIL') setEmailHint(suggestEmail(values.email));
      } else if (e.status === 400) {
        toast.error(e.message); // server-side validation details
      } else {
        toast.error(e.message);
      }
    }
  }, (invalid) => {
    // The form's own check stopped the submit: which field, never what was in it. The form then focuses
    // that field itself, which is not the visitor reaching it.
    ignoreFocusUntil.current = Date.now() + 500;
    const first = FORM_FIELDS.find((field) => field in invalid);
    sendVisit('REGISTER_ERROR', routes.register, { target: `field:${first ?? 'other'}` });
  });

  // How far down the form people get: each field once, when the visitor first focuses it.
  const reached = useRef(new Set<string>());
  const ignoreFocusUntil = useRef(0);
  const onFieldFocus = (event: FocusEvent<HTMLFormElement>) => {
    const name = event.target instanceof Element ? event.target.getAttribute('name') : null;
    if (Date.now() < ignoreFocusUntil.current) return;
    if (!name || !(FORM_FIELDS as readonly string[]).includes(name) || reached.current.has(name)) return;
    reached.current.add(name);
    sendVisit('REGISTER_FIELD', routes.register, { target: name });
  };

  // On a phone the email field is a screen above the button: an error written there and not shown
  // looked like a button that does nothing, and three people pressed it ten times into the rate limit.
  const showEmailError = (message: string) => {
    ignoreFocusUntil.current = Date.now() + 500;
    setError('email', { message }, { shouldFocus: true });
    document.getElementById('email')?.scrollIntoView({ block: 'center' });
  };

  const goToLogin = () =>
    void navigate(routes.login, { state: { email: getValues('email').trim().toLowerCase() } });

  // «Почали заповнювати» in the admin's visit funnel: the first thing typed, once per page. Only that
  // it happened is sent, never what was typed.
  const started = useRef(false);
  const onFirstInput = () => {
    if (started.current) return;
    started.current = true;
    sendVisit('REGISTER_STARTED', routes.register);
  };

  const fieldLabels: Record<(typeof FORM_FIELDS)[number], string> = {
    email: t('common.email'),
    password: t('auth.password'),
    promoCode: t('auth.promoCode'),
    consent: t('auth.missingConsent'),
  };
  const missing = FORM_FIELDS.filter((field) => errors[field]).map((field) => fieldLabels[field]);

  return (
    <AuthShell title={t('auth.registerTitle')}>
      <form noValidate onSubmit={onSubmit} onInput={onFirstInput} onFocus={onFieldFocus} className="space-y-4">
        <FormField label={t('common.email')} htmlFor="email" required error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            invalid={Boolean(errors.email)}
            {...emailField}
          />
          {emailHint && (
            <button
              type="button"
              data-track="register:email-fix"
              onClick={applyEmailHint}
              className="mt-1.5 block text-left text-sm font-semibold text-brand underline"
            >
              {t('auth.emailSuggestion', { email: emailHint })}
            </button>
          )}
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

        <div>
          <Button type="submit" fullWidth loading={isSubmitting || register$.isPending}>
            {t('auth.signUp')}
          </Button>
          {/* What is still missing, where the thumb already is: the field's own message may be a
              screen above, and a press that «did nothing» was being repeated into the rate limit. */}
          <p role="status" aria-live="polite" className="mt-2 min-h-[1.25rem] text-center text-sm text-red-600">
            {submitCount > 0 && missing.length > 0 ? t('auth.missingFields', { fields: missing.join(', ') }) : ''}
          </p>
        </div>

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
