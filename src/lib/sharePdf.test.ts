import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sharePdf } from './sharePdf.ts';

/**
 * The rung the master actually lands on depends on the DEVICE, not only on what the browser claims
 * it can share. The regression these tests exist for: Windows Chrome answers `canShare({ files })`
 * with `true` and then opens an OS sheet with no mail target and a «Copy» that copies nothing, so
 * the master could not send his shopping list anywhere.
 */
describe('sharePdf', () => {
  // Typed with the argument it is actually called with, so the assertions below can read it back.
  const share = vi.fn((_data: ShareData) => Promise.resolve());
  const canShare = vi.fn(() => true);
  const revokeObjectURL = vi.fn();

  function pointer(coarse: boolean) {
    Object.defineProperty(window, 'matchMedia', {
      value: vi.fn(() => ({ matches: coarse }) as MediaQueryList),
      configurable: true,
      writable: true,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(navigator, { share, canShare });
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:list'), revokeObjectURL });
    vi.stubGlobal('open', vi.fn(() => ({})));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const run = () => sharePdf(new Blob(['%PDF']), 'Список покупок.pdf', 'Список покупок');

  it('hands the file to the share sheet on a phone — Viber and mail are one tap from there', async () => {
    pointer(true);

    await run();

    expect(share).toHaveBeenCalledOnce();
    const files = share.mock.calls[0][0].files ?? [];
    expect(files[0]?.name).toBe('Список покупок.pdf');
    expect(files[0]?.type).toBe('application/pdf');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('NEVER opens the OS sheet on a desktop, even where canShare says yes (Windows Chrome)', async () => {
    pointer(false);

    await run();

    // The Windows sheet is a dead end: no mail client, and its «Copy» copies nothing.
    expect(share).not.toHaveBeenCalled();
    expect(canShare).not.toHaveBeenCalled();
    expect(window.open).toHaveBeenCalledWith('blob:list', '_blank');
  });

  it('treats a cancelled sheet as done, not as a failure to retry in a tab', async () => {
    pointer(true);
    share.mockRejectedValueOnce(Object.assign(new Error('cancelled'), { name: 'AbortError' }));

    await run();

    expect(window.open).not.toHaveBeenCalled();
  });

  it('falls back to a tab when a share target refuses the file', async () => {
    pointer(true);
    share.mockRejectedValueOnce(new Error('target refused'));

    await run();

    expect(window.open).toHaveBeenCalledWith('blob:list', '_blank');
  });

  it('falls back to a download link when the popup blocker eats the tab', async () => {
    pointer(false);
    vi.stubGlobal('open', vi.fn(() => null));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await run();

    expect(click).toHaveBeenCalledOnce();
    // Nothing is left attached to the document once the click has happened.
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('revokes the object URL a minute later, not while the tab is still loading it', async () => {
    pointer(false);

    await run();

    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:list');
  });
});
