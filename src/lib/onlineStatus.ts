import { onlineManager } from '@tanstack/react-query';

/**
 * Teach `onlineManager` the CURRENT network state, not merely its transitions.
 *
 * TanStack Query's own default (verified in `query-core/src/onlineManager.ts`) starts at
 * `#online = true` and then attaches nothing but window `online`/`offline` listeners — it never
 * reads `navigator.onLine`. Those events fire on a CHANGE, so an app STARTED with no network
 * believes it is online until the network comes back and a transition finally arrives.
 *
 * That single gap produced both of the failures reported from a phone in flight mode:
 *  - the offline banner never appeared, because `useOnline()` was told the app was online;
 *  - «Сформувати PDF» sailed past `useOnlineGuard` and fired a doomed request, so the master got
 *    «Не вдалося сформувати PDF» instead of «Для цієї дії потрібен інтернет».
 *
 * Toggling flight mode WHILE the app is open always worked, which is exactly why this survived
 * testing: that path delivers the transition event the default relies on.
 *
 * `visibilitychange` is here for the same reason, one level up: a phone freezes a backgrounded
 * tab, so a transition that happens while the app is asleep may never be delivered at all.
 * Returning to the foreground is the moment to re-read the truth rather than trust an event that
 * might not have come.
 */
export function installOnlineTracking(): void {
  onlineManager.setEventListener((setOnline) => {
    const sync = () => setOnline(currentlyOnline());
    // The seed. `setEventListener` runs this setup immediately, so the manager knows the real
    // state before the first component subscribes to it.
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  });
}

/**
 * `navigator.onLine` is only trustworthy in ONE direction: false really does mean no network,
 * while true only means an interface exists. That asymmetry suits us — we use it to stop doomed
 * requests, so a false negative would be the expensive mistake. Anything other than an explicit
 * `false` counts as online.
 */
function currentlyOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}
