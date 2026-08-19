import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';

/**
 * Guards a screen with unsaved edits against silent loss (review fix, first user: the act editor —
 * its quantities live only in component state until «Зберегти»).
 *
 * Two exits, two mechanisms:
 * - In-app navigation (the ← button, a swipe-back the router sees) → react-router's `useBlocker`.
 *   The caller renders a ConfirmDialog when `blocker.state === 'blocked'` and calls
 *   `blocker.proceed()` / `blocker.reset()` — a native `confirm()` would break the PWA feel and
 *   can't be styled or translated consistently.
 * - Tab close / reload / external navigation → `beforeunload`. Browsers only show their own generic
 *   prompt here; nothing custom is possible, so this is registered as a fallback only while dirty.
 *
 * Requires a data router (`createBrowserRouter` — the app's setup; tests use `createMemoryRouter`).
 */
export function useLeaveGuard(dirty: boolean, skipRef?: { readonly current: boolean }) {
  // `skipRef` is read INSIDE the callback (at navigation time, not render time) so a deliberate
  // exit — e.g. navigating away right after deleting the entity — can flip it synchronously and
  // pass through without waiting for a re-render.
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    dirty && !skipRef?.current && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  return blocker;
}
