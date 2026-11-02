import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, COMMIT_TIMEOUT_MS, LLM_TIMEOUT_MS, uploadTimeoutMs } from './client.ts';
import { sendOnce } from './submission.ts';
import { photosApi } from './photos.ts';
import { dictationApi } from './dictation.ts';
import { paymentsApi } from './payments.ts';

afterEach(() => vi.restoreAllMocks());

describe('sendOnce', () => {
  it('keeps the id across a failed attempt, which is the whole point', async () => {
    const seen: string[] = [];
    const send = (headers: { 'X-Entity-Uuid': string }) => {
      seen.push(headers['X-Entity-Uuid']);
      return seen.length === 1 ? Promise.reject(new Error('timeout')) : Promise.resolve('ok');
    };

    await expect(sendOnce('retry', send)).rejects.toThrow('timeout');
    await expect(sendOnce('retry', send)).resolves.toBe('ok');

    expect(seen[0]).toBe(seen[1]);
  });

  it('forgets the id once answered, so doing it again on purpose is a new submission', async () => {
    const seen: string[] = [];
    const send = (headers: { 'X-Entity-Uuid': string }) => {
      seen.push(headers['X-Entity-Uuid']);
      return Promise.resolve('ok');
    };

    await sendOnce('again', send);
    await sendOnce('again', send);

    expect(seen[0]).not.toBe(seen[1]);
  });

  it('gives different content a different id', async () => {
    const seen: string[] = [];
    const send = (headers: { 'X-Entity-Uuid': string }) => {
      seen.push(headers['X-Entity-Uuid']);
      return Promise.reject(new Error('timeout'));
    };

    await expect(sendOnce('a', send)).rejects.toThrow();
    await expect(sendOnce('b', send)).rejects.toThrow();

    expect(seen[0]).not.toBe(seen[1]);
  });
});

describe('the writes that needed it', () => {
  it('an upload retried after a timeout carries the same id', async () => {
    const post = vi.spyOn(api, 'post')
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ data: { id: 'p1' } });
    const file = new File(['x'], 'wall.jpg', { type: 'image/jpeg', lastModified: 1 });

    await expect(photosApi.upload('o1', file, { source: 'MANUAL' })).rejects.toThrow();
    await photosApi.upload('o1', file, { source: 'MANUAL' });

    const headersOf = (call: number) =>
      (post.mock.calls[call][2] as { headers: Record<string, string> }).headers;
    expect(headersOf(0)['X-Entity-Uuid']).toBeTruthy();
    expect(headersOf(1)['X-Entity-Uuid']).toBe(headersOf(0)['X-Entity-Uuid']);
  });

  it('a commit retried after a timeout carries the same id', async () => {
    const post = vi.spyOn(api, 'post')
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ data: {} });
    const items = [{ name: 'Шпаклювання' }] as never;

    await expect(dictationApi.commit('e1', items)).rejects.toThrow();
    await dictationApi.commit('e1', items);

    const configOf = (call: number) => post.mock.calls[call][2] as {
      headers: Record<string, string>;
      timeout: number;
    };
    expect(configOf(1).headers['X-Entity-Uuid']).toBe(configOf(0).headers['X-Entity-Uuid']);
    expect(configOf(0).timeout).toBe(COMMIT_TIMEOUT_MS);
  });

  it('a payment split carries one too', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: [] });

    await paymentsApi.commitSplit('o1', { total: 100 } as never);

    expect((post.mock.calls[0][2] as { headers: Record<string, string> }).headers['X-Entity-Uuid']).toBeTruthy();
  });
});

describe('uploadTimeoutMs', () => {
  it('gives a small file the floor', () => {
    expect(uploadTimeoutMs(100_000)).toBe(COMMIT_TIMEOUT_MS);
  });

  it('scales to what a site uplink can carry', () => {
    // 2 MB at 32 KB/s is more than a minute, and a 1 MB photo over 0.5 Mbps took 16 s against the old 12.
    expect(uploadTimeoutMs(2_000_000)).toBeGreaterThan(60_000);
  });

  it('never outlasts the longest wait anywhere in the app', () => {
    expect(uploadTimeoutMs(50_000_000)).toBe(LLM_TIMEOUT_MS);
  });
});
