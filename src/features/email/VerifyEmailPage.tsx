import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Spinner } from '@/components/Spinner.tsx';
import { Button } from '@/components/Button.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { tokens } from '@/lib/tokens.ts';
import { routes } from '@/lib/config.ts';
import { AuthShell } from '@/features/auth/LoginPage.tsx';
import { useResendVerification, useVerifyEmail } from './useEmailVerification.ts';

type State = 'loading' | 'success' | 'error' | 'notoken';

/**
 * Landing page for the email link (`/verify-email?token=...`). Public — the
 * user might open it logged out, on another device. Verifies on mount, then
 * redirects home a few seconds after success.
 */
export function VerifyEmailPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const verify = useVerifyEmail();
  const resend = useResendVerification();
  const [state, setState] = useState<State>('loading');
  const [errMsg, setErrMsg] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard React StrictMode double-invoke
    ran.current = true;
    if (!token) {
      setState('notoken');
      return;
    }
    verify
      .mutateAsync(token)
      .then(() => setState('success'))
      .catch((err) => {
        setErrMsg(toAppError(err).message);
        setState('error');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state !== 'success') return;
    const t = setTimeout(() => navigate(routes.home, { replace: true }), 3500);
    return () => clearTimeout(t);
  }, [state, navigate]);

  const onResend = async () => {
    try {
      await resend.mutateAsync();
      toast.success(t('email.sentCheckInbox'));
    } catch (err) {
      const e = toAppError(err);
      toast.error(e.status === 429 ? t('email.waitBeforeResendShort') : e.message);
    }
  };

  if (state === 'loading') {
    return (
      <AuthShell title={t('email.verifyTitle')}>
        <div className="flex flex-col items-center gap-3 py-4 text-brand">
          <Spinner size="lg" />
          <p className="text-sm text-muted">{t('email.verifying')}</p>
        </div>
      </AuthShell>
    );
  }

  if (state === 'success') {
    return (
      <AuthShell title={t('email.successTitle')}>
        <p className="mb-5 text-center text-sm text-muted">
          {t('email.successText')}
        </p>
        <Button fullWidth onClick={() => navigate(routes.home, { replace: true })}>
          {t('email.toHome')}
        </Button>
      </AuthShell>
    );
  }

  const title = state === 'notoken' ? t('email.noTokenTitle') : t('email.failedTitle');
  const message =
    state === 'notoken'
      ? t('email.noTokenText')
      : errMsg || t('email.failedText');

  return (
    <AuthShell title={title}>
      <p className="mb-5 text-center text-sm text-muted">{message}</p>
      {tokens.hasAny() ? (
        <Button fullWidth loading={resend.isPending} onClick={onResend}>
          {t('email.sendNewLetter')}
        </Button>
      ) : (
        <Button fullWidth onClick={() => navigate(routes.login, { replace: true })}>
          {t('auth.signIn')}
        </Button>
      )}
    </AuthShell>
  );
}
