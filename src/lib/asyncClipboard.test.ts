import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyWhenReady } from './asyncClipboard.ts';

/**
 * `ClipboardItem` doesn't exist in jsdom by default, so most existing call-site tests already
 * exercise the plain sequential fallback unchanged. These tests cover the new async-item path
 * directly, plus the fallback/refusal/propagation edges around it.
 */
describe('copyWhenReady', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // @ts-expect-error test cleanup — restore jsdom's default (no clipboard) between tests.
    delete navigator.clipboard;
  });

  it('falls back to the plain sequential write when ClipboardItem is unsupported (jsdom default)', async () => {
    expect(typeof ClipboardItem).toBe('undefined');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const mint = vi.fn().mockResolvedValue('https://majstr.pro/p/abc');

    const result = await copyWhenReady(mint);

    expect(mint).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('https://majstr.pro/p/abc');
    expect(result).toEqual({ copied: true, value: 'https://majstr.pro/p/abc' });
  });

  it('reports copied:false without throwing when there is no clipboard at all', async () => {
    // navigator.clipboard left undefined (insecure context / unsupported).
    const mint = vi.fn().mockResolvedValue('https://majstr.pro/p/abc');

    const result = await copyWhenReady(mint);

    expect(result).toEqual({ copied: false, value: 'https://majstr.pro/p/abc' });
  });

  it('uses the promise-based ClipboardItem when available, resolving mint() after the write call registers', async () => {
    class FakeClipboardItem {
      constructor(public items: Record<string, Promise<Blob> | Blob>) {}
    }
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const write = vi.fn().mockImplementation(async (items: FakeClipboardItem[]) => {
      // Simulate the browser resolving the promise-based representation internally.
      await items[0].items['text/plain'];
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { write, writeText } });

    const callOrder: string[] = [];
    const mint = vi.fn().mockImplementation(async () => {
      callOrder.push('mint-started');
      return 'https://majstr.pro/p/xyz';
    });

    const resultPromise = copyWhenReady(mint);
    // write() must already have been invoked synchronously — before this microtask runs.
    await Promise.resolve();
    callOrder.push('write-invoked:' + (write.mock.calls.length === 1));
    const result = await resultPromise;

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0][0]).toBeInstanceOf(FakeClipboardItem);
    expect(writeText).not.toHaveBeenCalled();
    expect(result).toEqual({ copied: true, value: 'https://majstr.pro/p/xyz' });
    expect(callOrder).toContain('write-invoked:true');
  });

  it('falls back to writeText when the async ClipboardItem write is refused, without losing the minted value', async () => {
    class FakeClipboardItem {
      constructor(public items: Record<string, Promise<Blob> | Blob>) {}
    }
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const write = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { write, writeText } });
    const mint = vi.fn().mockResolvedValue('https://majstr.pro/p/refused');

    const result = await copyWhenReady(mint);

    expect(writeText).toHaveBeenCalledWith('https://majstr.pro/p/refused');
    expect(result).toEqual({ copied: true, value: 'https://majstr.pro/p/refused' });
  });

  it('reports copied:false (not thrown) when both the item write and the writeText fallback fail', async () => {
    class FakeClipboardItem {
      constructor(public items: Record<string, Promise<Blob> | Blob>) {}
    }
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const write = vi.fn().mockRejectedValue(new Error('denied'));
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.assign(navigator, { clipboard: { write, writeText } });
    const mint = vi.fn().mockResolvedValue('https://majstr.pro/p/denied');

    const result = await copyWhenReady(mint);

    expect(result).toEqual({ copied: false, value: 'https://majstr.pro/p/denied' });
  });

  it('propagates a genuine mint() failure instead of reporting it as a copy failure', async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    const mint = vi.fn().mockRejectedValue(new Error('403 EMAIL_NOT_VERIFIED'));

    await expect(copyWhenReady(mint)).rejects.toThrow('403 EMAIL_NOT_VERIFIED');
    expect(writeText).not.toHaveBeenCalled();
  });
});
