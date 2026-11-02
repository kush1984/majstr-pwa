import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError, type AxiosResponse } from 'axios';
import { tokens } from '@/lib/tokens.ts';

const resetAnalytics = vi.hoisted(() => vi.fn());
const setSentryUser = vi.hoisted(() => vi.fn());
const dropLocalPushSubscription = vi.hoisted(() => vi.fn());

vi.mock('@/lib/posthog.ts', () => ({ resetAnalytics }));
vi.mock('@/lib/sentry.ts', () => ({ setSentryUser }));
vi.mock('@/lib/push.ts', () => ({ dropLocalPushSubscription }));

/**
 * A dead session ends with a hard redirect, and the reload does not undo what PostHog persisted, so
 * whoever used the phone next was recorded before consenting, as the last master (P-81). The phone also
 * kept showing that master's notifications (P-80).
 *
 * Its own file, with a fresh module per test: `forceLogin` latches after its first redirect.
 */

function jwtFor(sub: string): string {
  return `h.${btoa(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) - 3600 }))}.s`;
}

function refusedRefresh() {
  const err = new AxiosError('Unauthorized');
  err.response = { status: 401 } as AxiosResponse;
  vi.spyOn(axios, 'post').mockRejectedValue(err);
}

async function deadSession() {
  vi.resetModules();
  const { ensureAccessToken } = await import('./client.ts');
  tokens.set(jwtFor('master-a'), 'refresh-1');
  refusedRefresh();
  await ensureAccessToken();
}

beforeAll(() => {
  Object.defineProperty(window, 'location', {
    value: { href: 'http://localhost/projects', pathname: '/projects' },
    writable: true,
  });
});

beforeEach(() => {
  window.location.href = 'http://localhost/projects';
  window.location.pathname = '/projects';
  resetAnalytics.mockReset().mockResolvedValue(undefined);
  setSentryUser.mockReset();
  dropLocalPushSubscription.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a forced logout', () => {
  it('drops the analytics identity, the error identity and the push subscription', async () => {
    await deadSession();

    await vi.waitFor(() => expect(window.location.href).toContain('/login'));
    expect(resetAnalytics).toHaveBeenCalled();
    expect(setSentryUser).toHaveBeenCalledWith(null);
    expect(dropLocalPushSubscription).toHaveBeenCalledWith('master-a');
  });

  it('waits for the reset before leaving the page', async () => {
    let finishReset = () => {};
    resetAnalytics.mockReturnValue(new Promise<void>((resolve) => { finishReset = resolve; }));

    await deadSession();
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(window.location.href).not.toContain('/login');

    finishReset();
    await vi.waitFor(() => expect(window.location.href).toContain('/login'));
  });

  it('never strands the master on a dead screen when the cleanup hangs', async () => {
    resetAnalytics.mockReturnValue(new Promise<void>(() => {}));

    await deadSession();

    await vi.waitFor(() => expect(window.location.href).toContain('/login'), { timeout: 4000 });
  });
});
