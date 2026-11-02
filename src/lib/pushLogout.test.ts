import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dropPushOnLogout, resyncPushSubscription } from '@/hooks/usePush.ts';
import { pushApi } from '@/api/push.ts';
import { dropLocalPushSubscription, takeRememberedPushOwner } from './push.ts';
import { tokens } from './tokens.ts';

/**
 * A crew shares a phone. After a logout it must stop showing this master's client messages on the lock
 * screen (P-80), the master who comes back gets the subscription back, and nobody else does.
 */

const sub = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  unsubscribe: vi.fn().mockResolvedValue(true),
  toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } }),
};

function jwtFor(sub: string): string {
  return `h.${btoa(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }))}.s`;
}

function device(subscription: typeof sub | null, permission: NotificationPermission = 'granted') {
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(subscription),
    subscribe: vi.fn().mockResolvedValue(sub),
  };
  const reg = { pushManager };
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { permission });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: vi.fn().mockResolvedValue(reg), ready: Promise.resolve(reg) },
  });
  return pushManager;
}

beforeEach(() => {
  localStorage.clear();
  sub.unsubscribe.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('dropPushOnLogout', () => {
  it('drops the device subscription and tells the server with the token it was handed', async () => {
    device(sub);
    const unsubscribeAs = vi.spyOn(pushApi, 'unsubscribeAs').mockResolvedValue();

    await dropPushOnLogout('access-1', 'master-a');

    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(unsubscribeAs).toHaveBeenCalledWith(sub.endpoint, 'access-1');
  });

  it('still drops it when the server cannot be reached: the lock screen is what matters', async () => {
    device(sub);
    vi.spyOn(pushApi, 'unsubscribeAs').mockRejectedValue(new Error('offline'));

    await expect(dropPushOnLogout('access-1', 'master-a')).resolves.toBeUndefined();

    expect(sub.unsubscribe).toHaveBeenCalled();
  });

  it('does nothing on a device with no subscription', async () => {
    device(null);
    const unsubscribeAs = vi.spyOn(pushApi, 'unsubscribeAs').mockResolvedValue();

    await dropPushOnLogout('access-1', 'master-a');

    expect(unsubscribeAs).not.toHaveBeenCalled();
    expect(takeRememberedPushOwner()).toBeNull();
  });
});

describe('dropLocalPushSubscription', () => {
  it('needs no token, which a forced logout does not have', async () => {
    device(sub);

    await expect(dropLocalPushSubscription('master-a')).resolves.toBe(sub.endpoint);

    expect(sub.unsubscribe).toHaveBeenCalled();
  });

  it('never throws: a logout must not fail on it', async () => {
    device(sub);
    sub.unsubscribe.mockRejectedValueOnce(new Error('push service down'));

    await expect(dropLocalPushSubscription('master-a')).resolves.toBeNull();
  });
});

describe('the next login', () => {
  beforeEach(() => {
    vi.spyOn(pushApi, 'getVapidPublicKey').mockResolvedValue('AAAA');
    vi.spyOn(pushApi, 'subscribe').mockResolvedValue();
  });

  it('gives the same master their subscription back', async () => {
    const manager = device(sub);
    await dropLocalPushSubscription('master-a');
    manager.getSubscription.mockResolvedValue(null);
    tokens.set(jwtFor('master-a'), 'r');

    await resyncPushSubscription();

    expect(manager.subscribe).toHaveBeenCalled();
    expect(pushApi.subscribe).toHaveBeenCalled();
  });

  it('gives nobody else on the phone anything, and the note does not wait for the first master', async () => {
    const manager = device(sub);
    await dropLocalPushSubscription('master-a');
    manager.getSubscription.mockResolvedValue(null);
    tokens.set(jwtFor('master-b'), 'r');

    await resyncPushSubscription();

    expect(manager.subscribe).not.toHaveBeenCalled();
    expect(takeRememberedPushOwner()).toBeNull();
  });

  it('never prompts: a permission that was taken back stays taken back', async () => {
    const manager = device(sub, 'default');
    await dropLocalPushSubscription('master-a');
    manager.getSubscription.mockResolvedValue(null);
    tokens.set(jwtFor('master-a'), 'r');

    await resyncPushSubscription();

    expect(manager.subscribe).not.toHaveBeenCalled();
  });
});
