import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jsQR from 'jsqr';
import { decodeQr, looksFiscal, resetQrDecoder } from './qr.ts';

vi.mock('jsqr', () => ({ default: vi.fn(() => null) }));

/** What a Ukrainian fiscal receipt actually prints under the total. */
const FISCAL = 'https://cabinet.tax.gov.ua/cashregs/check?fn=4000123456&id=17&date=20260815&time=143005&sm=690.00';

type Global = { BarcodeDetector?: unknown };

/** jsdom has no 2D canvas, so jsqr can never be reached without standing one in. */
function installCanvas() {
  const ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  return ctx;
}

function installNative(detect: () => Promise<{ rawValue: string }[]>) {
  (globalThis as Global).BarcodeDetector = class {
    detect = detect;
  };
  resetQrDecoder();
}

const frame = {} as CanvasImageSource;

beforeEach(() => {
  vi.clearAllMocks();
  delete (globalThis as Global).BarcodeDetector;
  resetQrDecoder();
});
afterEach(() => vi.restoreAllMocks());

describe('looksFiscal', () => {
  it('accepts what a fiscal receipt prints and rejects every other kind of code', () => {
    expect(looksFiscal(FISCAL)).toBe(true);
    // A bare query string is what some registers encode — no host, no path.
    expect(looksFiscal('fn=4000123456&id=17&date=2026-08-15&sm=690')).toBe(true);
    // Case is not something a printer guarantees.
    expect(looksFiscal('?FN=4000123456&ID=17&DATE=20260815&SM=690')).toBe(true);

    expect(looksFiscal('WIFI:S:MyNet;T:WPA;P:secret;;')).toBe(false);
    expect(looksFiscal('https://example.com/promo?id=17&sm=690')).toBe(false); // no fn
    expect(looksFiscal('https://cabinet.tax.gov.ua/?fn=1&id=2&sm=3')).toBe(false); // no date
  });
});

describe('decodeQr', () => {
  it('prefers the native detector where the browser has one', async () => {
    const detect = vi.fn(() => Promise.resolve([{ rawValue: FISCAL }]));
    installNative(detect);
    const ctx = installCanvas();

    expect(await decodeQr(frame, 640, 480)).toBe(FISCAL);
    expect(detect).toHaveBeenCalledTimes(1);
    // The expensive path is not also walked: no pixels read, no jsqr.
    expect(ctx.getImageData).not.toHaveBeenCalled();
    expect(jsQR).not.toHaveBeenCalled();
  });

  it('falls back to jsqr when the native detector is absent — iOS Safari is half the phones', async () => {
    installCanvas();
    vi.mocked(jsQR).mockReturnValue({ data: FISCAL } as ReturnType<typeof jsQR>);

    expect(await decodeQr(frame, 640, 480)).toBe(FISCAL);
    expect(jsQR).toHaveBeenCalledTimes(1);
  });

  it('falls back to jsqr when the native detector throws on a frame', async () => {
    installNative(() => Promise.reject(new Error('detector blew up')));
    installCanvas();
    vi.mocked(jsQR).mockReturnValue({ data: FISCAL } as ReturnType<typeof jsQR>);

    // One bad frame must not end a scan that runs many times a second.
    expect(await decodeQr(frame, 640, 480)).toBe(FISCAL);
    expect(jsQR).toHaveBeenCalledTimes(1);
  });

  it('a frame with no code is a null, never a throw — that is the normal case while aiming', async () => {
    installNative(() => Promise.resolve([]));
    installCanvas();
    vi.mocked(jsQR).mockReturnValue(null);

    await expect(decodeQr(frame, 640, 480)).resolves.toBeNull();
  });

  it('a not-yet-sized video frame is skipped before any work is done', async () => {
    const ctx = installCanvas();

    expect(await decodeQr(frame, 0, 0)).toBeNull();
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(jsQR).not.toHaveBeenCalled();
  });

  it('survives an environment with no 2D canvas at all', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    await expect(decodeQr(frame, 640, 480)).resolves.toBeNull();
    expect(jsQR).not.toHaveBeenCalled();
  });
});
