import { createBrowserRouter, Navigate } from 'react-router-dom';
import { LoginPage } from '@/features/auth/LoginPage.tsx';
import { RegisterPage } from '@/features/auth/RegisterPage.tsx';
import { LandingPage } from '@/features/landing/LandingPage.tsx';
import { AppLayout } from '@/features/app/AppLayout.tsx';
import { DashboardPage } from '@/features/dashboard/DashboardPage.tsx';
import { ProjectsPage } from '@/features/projects/ProjectsPage.tsx';
import { ProjectDetailPage } from '@/features/projects/ProjectDetailPage.tsx';
import { NewObjectPage } from '@/features/projects/NewObjectPage.tsx';
import { CatalogPage } from '@/features/catalog/CatalogPage.tsx';
import { CatalogImportPage } from '@/features/catalog/CatalogImportPage.tsx';
import { TemplatesPage } from '@/features/estimate/TemplatesPage.tsx';
import { ProfilePage } from '@/features/profile/ProfilePage.tsx';
import { NewEstimatePage } from '@/features/estimate/NewEstimatePage.tsx';
import { EstimateEditorPage } from '@/features/estimate/EstimateEditorPage.tsx';
import { VerifyEmailPage } from '@/features/email/VerifyEmailPage.tsx';
import { PrivacyPage } from '@/features/legal/PrivacyPage.tsx';
import { BillingReturnPage } from '@/features/billing/BillingReturnPage.tsx';
import { ProtectedRoute, PublicOnlyRoute } from './ProtectedRoute.tsx';
import { tokens } from '@/lib/tokens.ts';
import { routes } from '@/lib/config.ts';
import { storeRef } from '@/lib/referral.ts';

/**
 * Partner alias: /liga stores the referral first-touch (ref=liga) then drops the
 * visitor on the normal landing. A clean URL a partner can print/share; the same
 * shape works for any future partner via ?ref=<code>.
 */
function LigaRoute() {
  storeRef('liga');
  return <Navigate to={routes.home} replace />;
}

/**
 * The root "/" gate. A logged-OUT visitor (no token in storage) gets the public
 * marketing landing — no API call, paints instantly. A logged-IN visitor gets
 * the dashboard inside the normal app shell (unchanged from before). Anything
 * subtle about an expired/invalid token is handled by ProtectedRoute → useMe
 * (spinner → retry/redirect), exactly like the other authed routes.
 */
function HomeRoute() {
  if (!tokens.hasAny()) return <LandingPage />;
  return (
    <ProtectedRoute>
      <AppLayout>
        <DashboardPage />
      </AppLayout>
    </ProtectedRoute>
  );
}

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
  // Public: the email-verification link works whether logged in or out.
  { path: routes.verifyEmail, element: <VerifyEmailPage /> },
  // Public: the privacy policy is reachable without auth (landing footer, the
  // registration consent link, robots-indexable).
  { path: routes.privacy, element: <PrivacyPage /> },
  // Public partner alias: stores ref=liga first-touch, then → landing.
  { path: routes.liga, element: <LigaRoute /> },
  // Root: marketing landing for guests, dashboard for authed users.
  { path: routes.home, element: <HomeRoute /> },
  {
    // Authenticated shell — sidebar (desktop) / bottom nav (mobile).
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { path: routes.projects, element: <ProjectsPage /> },
      { path: '/projects/:id', element: <ProjectDetailPage /> },
      { path: routes.catalog, element: <CatalogPage /> },
      { path: routes.templates, element: <TemplatesPage /> },
      { path: routes.profile, element: <ProfilePage /> },
    ],
  },
  {
    // Full-screen surfaces (no nav chrome) — own back button, like the mockups.
    element: <ProtectedRoute />,
    children: [
      { path: routes.newEstimate, element: <NewEstimatePage /> },
      // Static '/projects/new' ranks above the '/projects/:id' detail route.
      { path: routes.newObject, element: <NewObjectPage /> },
      // Static '/catalog/import' ranks above nothing dynamic, but keep it here as a
      // full-screen wizard (its own back button), not inside the tab shell.
      { path: routes.catalogImport, element: <CatalogImportPage /> },
      { path: '/estimates/:id', element: <EstimateEditorPage /> },
      // Post-payment landing — polls /me until the webhook grants PRO.
      { path: routes.billingReturn, element: <BillingReturnPage /> },
    ],
  },
  // Unknown route → home; ProtectedRoute bounces to /login if needed.
  { path: '*', element: <Navigate to={routes.home} replace /> },
]);
