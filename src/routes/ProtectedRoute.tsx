import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useMe } from '@/features/auth/useMe.ts';
import { tokens } from '@/lib/tokens.ts';
import { useOnline } from '@/lib/useOnline.ts';
import { toAppError } from '@/api/errors.ts';
import { Spinner } from '@/components/Spinner.tsx';
import { ErrorState } from '@/components/ErrorState.tsx';
import { routes } from '@/lib/config.ts';

interface ProtectedRouteProps {
  children?: ReactNode;
}

/**
 * Auth gate. Works both wrapping a single page (`<ProtectedRoute><Page/></>`)
 * and as a layout route (`<ProtectedRoute />` → renders the nested <Outlet/>).
 * States:
 *  - no token in storage → redirect immediately, no API call.
 *  - token present, /me in flight → spinner.
 *  - /me failed with 401/403 (token rejected, refresh chain exhausted) →
 *    clear the stale tokens and redirect to /login.
 *  - /me failed transiently (offline / backend down / 5xx) → keep the tokens
 *    and show a friendly retry screen. Logging the user out over a network
 *    blip would just lose their session for nothing.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const hasToken = tokens.hasAny();
  const me = useMe();

  if (!hasToken) return <Navigate to={routes.login} replace />;
  // A CACHED user (restored from the offline cache) is enough to open the app — the master must be
  // able to work in a basement. Checked before isPending/isError so a failed refetch never locks
  // them out of data they already have on the device.
  if (me.data) return <>{children ?? <Outlet />}</>;
  if (me.isPending) return <FullPageSpinner />;
  if (me.isError) {
    const status = toAppError(me.error).status;
    if (status === 401 || status === 403) {
      // Definitive rejection — don't leave dead tokens in storage.
      tokens.clear();
      return <Navigate to={routes.login} replace />;
    }
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas">
        <ErrorState error={me.error} onRetry={() => void me.refetch()} />
      </div>
    );
  }
  return <>{children ?? <Outlet />}</>;
}

/**
 * Inverse of ProtectedRoute — bounces logged-in users away from /login and /register.
 *
 * It must NEVER hold the login page behind a spinner: a master with leftover tokens who opens the
 * app with no connection has to at least SEE the login screen (that hang was a real prod report).
 * So we only wait while a `/me` check is genuinely in flight AND we're online.
 */
export function PublicOnlyRoute({ children }: ProtectedRouteProps) {
  const hasToken = tokens.hasAny();
  const online = useOnline();
  const { data, isPending } = useMe();
  if (hasToken && data) return <Navigate to={routes.home} replace />;
  if (hasToken && isPending && online) return <FullPageSpinner />;
  return <>{children}</>;
}

function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 text-brand-600">
      <Spinner size="lg" />
    </div>
  );
}
