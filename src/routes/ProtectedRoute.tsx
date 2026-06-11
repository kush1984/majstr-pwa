import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useMe } from '@/features/auth/useMe.ts';
import { tokens } from '@/lib/tokens.ts';
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

/** Inverse of ProtectedRoute — used to bounce logged-in users away
 *  from /login and /register. */
export function PublicOnlyRoute({ children }: ProtectedRouteProps) {
  const hasToken = tokens.hasAny();
  const { data, isPending } = useMe();
  if (hasToken && isPending) return <FullPageSpinner />;
  if (hasToken && data) return <Navigate to={routes.home} replace />;
  return <>{children}</>;
}

function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 text-brand-600">
      <Spinner size="lg" />
    </div>
  );
}
