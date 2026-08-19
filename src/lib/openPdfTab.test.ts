import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openPdfTab } from './openPdfTab.ts';

/**
 * The iOS-Safari contract: the tab is reserved SYNCHRONOUSLY (before the fetch's await can spend
 * the click's user activation), filled once the blob URL is ready, and closed again if the fetch
 * fails — never a stranded blank tab, never an open-after-await.
 */
describe('openPdfTab', () => {
  const revoke = vi.fn();
  let reserved: { location: { href: string }; close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    reserved = { location: { href: '' }, close: vi.fn() };
    vi.stubGlobal('open', vi.fn(() => reserved));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('reserves the tab before the fetch resolves, then fills its location', async () => {
    let resolveFetch!: (v: { url: string; revoke: () => void }) => void;
    const fetchPdf = vi.fn(() => new Promise<{ url: string; revoke: () => void }>((r) => { resolveFetch = r; }));

    const run = openPdfTab(fetchPdf);
    expect(window.open).toHaveBeenCalledWith('', '_blank'); // reserved synchronously
    expect(reserved.location.href).toBe('');

    resolveFetch({ url: 'blob:pdf-1', revoke });
    await run;
    expect(reserved.location.href).toBe('blob:pdf-1');
    expect(reserved.close).not.toHaveBeenCalled();
  });

  it('falls back to a plain open when even the blank reservation was blocked', async () => {
    vi.stubGlobal('open', vi.fn(() => null));

    await openPdfTab(() => Promise.resolve({ url: 'blob:pdf-2', revoke }));

    expect(window.open).toHaveBeenNthCalledWith(1, '', '_blank');
    expect(window.open).toHaveBeenNthCalledWith(2, 'blob:pdf-2', '_blank');
  });

  it('closes the reserved tab and rethrows when the fetch fails', async () => {
    await expect(openPdfTab(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(reserved.close).toHaveBeenCalled();
  });

  it('revokes the blob URL a minute later, not immediately', async () => {
    await openPdfTab(() => Promise.resolve({ url: 'blob:pdf-3', revoke }));

    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledOnce();
  });
});
