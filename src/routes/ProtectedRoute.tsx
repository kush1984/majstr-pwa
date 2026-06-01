import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useMe } from '@/features/auth/useMe.ts';
import { tokens } from '@/lib/tokens.ts';
import { Spinner } from '@/components/Spinner.tsx';
import { routes } from '@/lib/config.ts';

interface ProtectedRouteProps {
  children?: ReactNode;
}

/**
 * Auth gate. Works both wrapping a single page (`<ProtectedRoute><Page/></>`)
 * and as a layout route (`<ProtectedRoute />` → renders the nested <Outlet/>).
 * Three states:
 *  - no token in storage → redirect immediately, no API call.
 *  - token present, /me in flight → spinner.
 *  - /me failed (refresh also failed, interceptor already cleared tokens) → redirect.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const hasToken = tokens.hasAny();
  const { isPending, isError } = useMe();

  if (!hasToken) return <Navigate to={routes.login} replace />;
  if (isPending) return <FullPageSpinner />;
  if (isError) return <Navigate to={routes.login} replace />;
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
