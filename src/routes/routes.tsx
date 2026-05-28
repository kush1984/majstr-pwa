import { createBrowserRouter, Navigate } from 'react-router-dom';
import { LoginPage } from '@/features/auth/LoginPage.tsx';
import { RegisterPage } from '@/features/auth/RegisterPage.tsx';
import { DashboardPage } from '@/features/dashboard/DashboardPage.tsx';
import { ProtectedRoute, PublicOnlyRoute } from './ProtectedRoute.tsx';
import { routes } from '@/lib/config.ts';

export const router = createBrowserRouter([
  {
    path: routes.login,
    element: (
      <PublicOnlyRoute>
        <LoginPage />
      </PublicOnlyRoute>
    ),
  },
  {
    path: routes.register,
    element: (
      <PublicOnlyRoute>
        <RegisterPage />
      </PublicOnlyRoute>
    ),
  },
  {
    path: routes.dashboard,
    element: (
      <ProtectedRoute>
        <DashboardPage />
      </ProtectedRoute>
    ),
  },
  // Anything else — send to /dashboard; ProtectedRoute will bounce
  // to /login if not authenticated.
  { path: '*', element: <Navigate to={routes.dashboard} replace /> },
]);
