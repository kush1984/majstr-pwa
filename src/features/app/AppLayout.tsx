import { useEffect, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn.ts';
import { initials } from '@/lib/format.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { useAutoPrefetch } from '@/lib/useAutoPrefetch.ts';
import { setSentryUser } from '@/lib/sentry.ts';
import { resyncPushSubscription } from '@/hooks/usePush.ts';
import { usePushRefresh } from '@/hooks/usePushRefresh.ts';
import { EmailVerificationBanner } from '@/features/email/EmailVerificationBanner.tsx';
import { NotificationBell } from '@/components/NotificationBell.tsx';
import { PrivacyConsentModal } from '@/features/legal/ConsentModals.tsx';
import { CatalogUpdateNotice } from '@/features/catalog/CatalogUpdateNotice.tsx';
import { NAV_ITEMS } from './navItems.ts';

/**
 * The authenticated shell. One component, two layouts via Tailwind:
 *  - <lg: a fixed bottom nav, single content column.
 *  - ≥lg: a left sidebar (logo + nav + profile), content capped at max-w-app.
 */
export function AppLayout({ children }: { children?: ReactNode }) {
  const { data: me } = useMe();
  const { t } = useTranslation();

  // Fill the offline cache in the background (throttled) so every screen works in a basement.
  useAutoPrefetch();

  // A push arriving while the app is open has to move the bell, not just ring it.
  usePushRefresh();

  // Tag Sentry with the user id on (re)load while already logged in — login()
  // covers the fresh-login path; this covers boot-from-home-screen.
  useEffect(() => {
    if (me?.id) setSentryUser(me.id);
  }, [me?.id]);

  // Keep the backend's stored push subscription in sync with the browser's
  // actual one: re-POST it on every app open, and again whenever the SW reports
  // the subscription rotated (pushsubscriptionchange). Without this, a rotated
  // subscription leaves the backend pushing to a dead endpoint (FCM 201, no
  // notification) until the user manually re-toggles.
  useEffect(() => {
    void resyncPushSubscription();
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === 'push-subscription-changed') {
        void resyncPushSubscription();
      }
    };
    sw.addEventListener('message', onMessage);
    return () => sw.removeEventListener('message', onMessage);
  }, []);

  return (
    <div className="min-h-dvh bg-canvas lg:flex">
      {/* Desktop sidebar — pinned to the viewport so the profile (bottom) is
          always visible; only the main content scrolls. Scrolls internally if
          the nav ever exceeds the viewport height. */}
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:flex-col lg:self-start lg:overflow-y-auto lg:border-r lg:border-border lg:bg-surface lg:p-3.5">
        <div className="px-3 pb-5 pt-2 text-[22px] font-extrabold tracking-tight text-brand">
          Majstr
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-soft font-semibold text-brand'
                    : 'text-muted hover:bg-surface-sunken',
                )
              }
            >
              <span className="w-5 text-center text-lg">{it.icon}</span>
              {t(it.labelKey)}
            </NavLink>
          ))}
        </nav>
        <div className="flex-1" />
        <NavLink
          to="/profile"
          className="mt-2 flex items-center gap-2.5 border-t border-border px-3 pb-1 pt-4"
        >
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
            {initials(me?.fullName) || '—'}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-primary">
              {me?.fullName ?? '...'}
            </span>
            <span className="block text-[11px] text-muted">
              {t('app.planShort', { plan: me?.plan ?? '' })}
            </span>
          </span>
        </NavLink>
      </aside>

      {/* Content column */}
      <div className="flex-1">
        <main className="mx-auto w-full max-w-app px-4 pb-24 pt-4 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
          <div className="mb-3 flex justify-end lg:mb-4">
            <NotificationBell />
          </div>
          <EmailVerificationBanner />
          {/* `/` renders the dashboard as a child (HomeRoute); the other
              authed pages render through the nested router Outlet. */}
          {children ?? <Outlet />}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        {NAV_ITEMS.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold transition-colors',
                isActive ? 'text-brand' : 'text-muted',
              )
            }
          >
            <span className="text-[22px] leading-none">{it.icon}</span>
            {t(it.labelKey)}
          </NavLink>
        ))}
      </nav>

      {/* One-time privacy consent for users who predate the registration checkbox. */}
      {me && me.consentedToPrivacyAt == null && <PrivacyConsentModal />}

      {/* One-time "we changed your catalog" notice. Renders nothing unless one is pending, and
          sits behind consent so a first-run user is not handed two modals at once. */}
      {me && me.consentedToPrivacyAt != null && <CatalogUpdateNotice />}
    </div>
  );
}
