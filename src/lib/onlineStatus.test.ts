import { describe, it, expect, afterEach, vi } from 'vitest';
import { onlineManager } from '@tanstack/react-query';
import { installOnlineTracking } from './onlineStatus.ts';

/** jsdom exposes `navigator.onLine` as a getter, so this is the only way to move it. */
function pretendNetwork(online: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
}

afterEach(() => {
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
});

describe('the online state the whole UI reads', () => {
  it('is read from the device AT STARTUP, which is the bug this file exists for', () => {
    // Reported from a phone in flight mode: no offline banner, and «Сформувати PDF» answered
    // «Не вдалося сформувати PDF» instead of «Для цієї дії потрібен інтернет». One cause for both —
    // TanStack seeds its manager to `true` and then listens ONLY for transition events, so an app
    // OPENED with no network is never told. Toggling flight mode while the app is already open
    // always worked, which is precisely why this survived testing.
    pretendNetwork(false);

    installOnlineTracking();

    expect(onlineManager.isOnline()).toBe(false);
  });

  it('still follows the browser events after the seed', () => {
    pretendNetwork(true);
    installOnlineTracking();
    expect(onlineManager.isOnline()).toBe(true);

    pretendNetwork(false);
    window.dispatchEvent(new Event('offline'));
    expect(onlineManager.isOnline()).toBe(false);

    pretendNetwork(true);
    window.dispatchEvent(new Event('online'));
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('re-reads the device when the app returns to the foreground', () => {
    // A phone freezes a backgrounded tab, so a transition that happens while the app is asleep can
    // be delivered late or not at all. Becoming visible again is a moment we can check for free.
    pretendNetwork(true);
    installOnlineTracking();

    pretendNetwork(false);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(onlineManager.isOnline()).toBe(false);
  });

  it('treats an unknown network state as online, never as offline', () => {
    // `navigator.onLine` is trustworthy only when false. Guessing "offline" from a missing value
    // would disable PDFs and sharing on a perfectly connected device — the costlier mistake.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(undefined as unknown as boolean);

    installOnlineTracking();

    expect(onlineManager.isOnline()).toBe(true);
  });
});
