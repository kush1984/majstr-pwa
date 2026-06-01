import { createBrowserRouter, Navigate } from 'react-router-dom';
import { LoginPage } from '@/features/auth/LoginPage.tsx';
import { RegisterPage } from '@/features/auth/RegisterPage.tsx';
import { AppLayout } from '@/features/app/AppLayout.tsx';
import { DashboardPage } from '@/features/dashboard/DashboardPage.tsx';
import { ProjectsPage } from '@/features/projects/ProjectsPage.tsx';
import { ProjectDetailPage } from '@/features/projects/ProjectDetailPage.tsx';
import { CatalogPage } from '@/features/catalog/CatalogPage.tsx';
import { ProfilePage } from '@/features/profile/ProfilePage.tsx';
import { NewEstimatePage } from '@/features/estimate/NewEstimatePage.tsx';
import { EstimateEditorPage } from '@/features/estimate/EstimateEditorPage.tsx';
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
    // Authenticated shell — sidebar (desktop) / bottom nav (mobile).
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { path: routes.home, element: <DashboardPage /> },
      { path: routes.projects, element: <ProjectsPage /> },
      { path: '/projects/:id', element: <ProjectDetailPage /> },
      { path: routes.catalog, element: <CatalogPage /> },
      { path: routes.profile, element: <ProfilePage /> },
    ],
  },
  {
    // Full-screen surfaces (no nav chrome) — own back button, like the mockups.
    element: <ProtectedRoute />,
    children: [
      { path: routes.newEstimate, element: <NewEstimatePage /> },
      { path: '/estimates/:id', element: <EstimateEditorPage /> },
    ],
  },
  // Unknown route → home; ProtectedRoute bounces to /login if needed.
  { path: '*', element: <Navigate to={routes.home} replace /> },
]);
