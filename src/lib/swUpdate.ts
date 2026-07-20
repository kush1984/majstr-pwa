/**
 * Bridge between the service-worker registration (in `main.tsx`, outside React) and a
 * React banner. When a new build's SW is waiting, `main.tsx` calls `markUpdateReady` with
 * the `updateSW` function; the banner subscribes and, on the user's click, calls
 * `applyUpdate()` to activate the new SW and reload. We never reload silently — a master
 * may be mid-estimate, so the reload is their choice.
 */

type Listener = () => void;

let ready = false;
let updater: (() => void) | null = null;
const listeners = new Set<Listener>();

/** Called by the SW registration when a new version is waiting. */
export function markUpdateReady(apply: () => void): void {
  ready = true;
  updater = apply;
  listeners.forEach((l) => l());
}

export function isUpdateReady(): boolean {
  return ready;
}

/** Activate the waiting SW and reload onto the new version. */
export function applyUpdate(): void {
  updater?.();
}

export function subscribeUpdate(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
