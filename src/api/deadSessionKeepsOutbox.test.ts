import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import axios, { AxiosError, type AxiosResponse } from 'axios';
import { ensureAccessToken } from './client.ts';
import { tokens } from '@/lib/tokens.ts';
import { enqueue, listOutbox } from '@/lib/outbox/outbox.ts';

/**
 * The production regression, pinned: **a dying session must not take the master's unsynced
 * work with it.**
 *
 * What happened: rotation revokes the old refresh token the instant it is used, and the client
 * only stores the replacement once the response arrives. On a bad connection — a lift, a
 * basement, a half-built flat, i.e. an ordinary working day — the request landed and the reply
 * did not, leaving the client holding a token the server had already killed. The next call
 * 4xx'd, `forceLogin` ran, and it wiped the outbox: work the master had genuinely done,
 * destroyed by a network blip they never saw. (The server side of this is the rotation grace
 * window; this is the client side, which must hold even when the grace is exhausted.)
 *
 * **This lives in its own file on purpose.** `forceLogin` latches `redirectingToLogin` after
 * its first run, and every other test in `client.test.ts` that exercises a dead session trips
 * that latch — so the cleanup block would be skipped and this assertion would pass whether or
 * not the fix were present. A separate file gets a fresh module registry, so the latch is
 * unset and the cleanup path genuinely runs.
 */

beforeAll(() => {
  // jsdom can't navigate; give forceLogin a plain object to write to.
  Object.defineProperty(window, 'location', {
    value: { href: 'http://localhost/', pathname: '/' },
    writable: true,
  });
});

function expiredJwt(): string {
  const payload = btoa(JSON.stringify({ sub: 'master-a', exp: Math.floor(Date.now() / 1000) - 60 }));
  return `header.${payload}.signature`;
}

describe('a dead session', () => {
  it('clears the tokens but keeps the queued offline work', async () => {
    await enqueue({ entityId: 'c1', entity: 'client', type: 'create', payload: {}, deps: [] });
    tokens.set(expiredJwt(), 'refresh-revoked');
    const err = new AxiosError('Request failed with status code 401');
    err.response = { status: 401 } as AxiosResponse;
    vi.spyOn(axios, 'post').mockRejectedValue(err);

    await expect(ensureAccessToken()).resolves.toBeNull();
    // forceLogin's cleanup is fire-and-forget (it races the redirect), so the assertion must
    // outlast it — without this wait the old wiping code passed this test too.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(tokens.getAccess()).toBeNull();      // the session is gone…
    expect(await listOutbox()).toHaveLength(1); // …the work is not
  });
});
