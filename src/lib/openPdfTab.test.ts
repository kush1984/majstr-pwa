import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openPdfTab, reservePdfTab } from './openPdfTab.ts';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

function onDevice(userAgent: string, standalone = false): void {
  vi.stubGlobal('navigator', { ...navigator, userAgent, platform: '', maxTouchPoints: 5, standalone });
}

/**
 * The iOS-Safari contract: the tab is reserved SYNCHRONOUSLY — in the tap, before any await can
 * spend the user activation — filled once the blob URL is ready, and closed again on failure or an
 * early return. In the installed app on an iPhone the PDF is downloaded instead (a blob window comes
 * up blank there). Off iOS nothing is reserved: the plain open-after-fetch works (review P1-18).
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

  it('on an iPhone, reserves the tab before the fetch resolves, then fills its location', async () => {
    onDevice(IPHONE_UA);
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

  it('a tab reserved in the tap survives the awaits before the fetch — and closes on an early return', async () => {
    onDevice(IPHONE_UA);
    const tab = reservePdfTab();
    expect(window.open).toHaveBeenCalledWith('', '_blank');
    await Promise.resolve(); // the save / email gate / outbox check
    tab.cancel();
    expect(reserved.close).toHaveBeenCalled();
  });

  it('on an iPhone, falls back to a plain open when even the blank reservation was blocked', async () => {
    onDevice(IPHONE_UA);
    vi.stubGlobal('open', vi.fn(() => null));

    await openPdfTab(() => Promise.resolve({ url: 'blob:pdf-2', revoke }));

    expect(window.open).toHaveBeenNthCalledWith(1, '', '_blank');
    expect(window.open).toHaveBeenNthCalledWith(2, 'blob:pdf-2', '_blank');
  });

  it('in the installed app on an iPhone, downloads the PDF instead of opening a window', async () => {
    onDevice(IPHONE_UA, true);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await openPdfTab(() => Promise.resolve({ url: 'blob:pdf-4', revoke }), 'koshtorys.pdf');

    expect(window.open).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it('off iOS, reserves nothing and opens once the blob is ready', async () => {
    onDevice(ANDROID_UA);
    await openPdfTab(() => Promise.resolve({ url: 'blob:pdf-5', revoke }));
    expect(window.open).toHaveBeenCalledTimes(1);
    expect(window.open).toHaveBeenCalledWith('blob:pdf-5', '_blank');
  });

  it('closes the reserved tab and rethrows when the fetch fails', async () => {
    onDevice(IPHONE_UA);
    await expect(openPdfTab(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(reserved.close).toHaveBeenCalled();
  });

  it('revokes the blob URL a minute later, not immediately', async () => {
    onDevice(IPHONE_UA);
    await openPdfTab(() => Promise.resolve({ url: 'blob:pdf-3', revoke }));

    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledOnce();
  });
});
