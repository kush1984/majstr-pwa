import { createBrowserRouter, Navigate } from 'react-router-dom';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { ProtectedRoute, PublicOnlyRoute } from './ProtectedRoute';
import { routes } from '@/lib/config';

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
