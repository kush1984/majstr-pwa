import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/api/auth.ts';
import { toAppError } from '@/api/errors.ts';
import { config, routes } from '@/lib/config.ts';
import { isInAppBrowser } from '@/lib/inAppBrowser.ts';
import { getStoredFirstTouch, getStoredRef, getStoredUtm } from '@/lib/referral.ts';
import { toast } from '@/hooks/useToast.ts';
import { startSession } from './startSession.ts';
import { afterLoginPath } from './afterLogin.ts';

const SCRIPT = 'https://accounts.google.com/gsi/client';

interface GoogleId {
  initialize(options: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }): void;
  renderButton(el: HTMLElement, options: Record<string, unknown>): void;
}
type WithGoogle = Window & { google?: { accounts?: { id?: GoogleId } } };

let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { loading = null; reject(new Error('Google script did not load')); };
    document.head.appendChild(script);
  });
  return loading;
}

/** Whether «Увійти через Google» is offered here: configured, online and not inside an app's browser. */
export function googleSignInAvailable(): boolean {
  return config.googleClientId !== '' && !isInAppBrowser() && (typeof navigator === 'undefined' || navigator.onLine);
}

/**
 * «Увійти через Google» — one button for signing in AND registering (the server links a same-email
 * account). Drawn by Google itself; renders nothing where it cannot work, so the email form stands alone.
 */
export function GoogleSignIn() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  // A ref, not a dependency: the button is drawn once; the target is read when Google answers.
  const target = useRef(afterLoginPath(useLocation().state));
  const slot = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const available = googleSignInAvailable();

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    loadScript().then(() => {
      const id = (window as WithGoogle).google?.accounts?.id;
      if (cancelled || !id || !slot.current) return;
      id.initialize({
        client_id: config.googleClientId,
        callback: ({ credential }) => {
          void authApi.google({
            credential,
            ref: getStoredRef(),
            ...getStoredUtm(),
            ...getStoredFirstTouch(),
          })
            .then((data) => startSession(qc, data))
            .then(() => navigate(target.current, { replace: true }))
            .catch((err: unknown) => {
              // A refused token answers 401 «wrong email or password», which names nothing he typed. A gmail
              // alias of a password account (409) says it in the server's own words.
              const e = toAppError(err);
              toast.error(e.status === 409 ? e.message : t('auth.googleFailed'));
            });
        },
      });
      id.renderButton(slot.current, {
        type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular',
        width: Math.min(slot.current.clientWidth || 320, 400), locale: 'uk',
      });
      setReady(true);
    }).catch(() => { /* no Google, no button — the email form is there */ });
    return () => { cancelled = true; };
  }, [available, qc, navigate, t]);

  if (!available) return null;
  return (
    <div className="mb-4 space-y-3">
      <div ref={slot} className="flex min-h-[44px] w-full justify-center" data-testid="google-sign-in" />
      {ready && (
        <p className="text-center text-xs text-muted">
          {t('auth.googleConsentPre')}{' '}
          <Link to={routes.privacy} className="underline">{t('consent.privacyLink')}</Link>
        </p>
      )}
      {ready && (
        <p className="flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-border" />
          {t('auth.orWithEmail')}
          <span className="h-px flex-1 bg-border" />
        </p>
      )}
    </div>
  );
}
