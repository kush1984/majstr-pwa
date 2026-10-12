import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jsQR from 'jsqr';
import { decodeQrFromFile, looksFiscal, resetQrDecoder } from './qr.ts';

vi.mock('jsqr', () => ({ default: vi.fn(() => null) }));

/** What a Ukrainian fiscal receipt actually prints under the total. */
const FISCAL = 'https://cabinet.tax.gov.ua/cashregs/check?fn=4000123456&id=17&date=20260815&time=143005&sm=690.00';
/** And what it prints BESIDE it: the shop's own marketing code, sparse and trivially readable. */
const MARKETING = 'https://shorturl.at/Qosce';

type Global = { BarcodeDetector?: unknown };

/** jsdom has no 2D canvas, so jsqr can never be reached without standing one in. */
function installCanvas(side = 1) {
  const ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({
      data: new Uint8ClampedArray(side * side * 4),
      width: side,
      height: side,
    })),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  return ctx;
}

/** jsdom never decodes an image, so the picked-photo path needs one that simply reports a size. */
function installImage(width: number, height: number) {
  class FakeImage {
    naturalWidth = width;
    naturalHeight = height;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_url: string) {
      setTimeout(() => this.onload?.(), 0);
    }
  }
  vi.stubGlobal('Image', FakeImage);
  URL.createObjectURL = vi.fn(() => 'blob:receipt');
  URL.revokeObjectURL = vi.fn();
}

beforeEach(() => {
  vi.clearAllMocks();
  delete (globalThis as Global).BarcodeDetector;
  resetQrDecoder();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

describe('decodeQrFromFile', () => {
  const photo = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });

  it('keeps looking past the plain pass — the dense code only reads once preprocessed', async () => {
    installImage(400, 400);
    installCanvas(400);
    // Plain misses, the full adaptive frame misses, a tile around the code finds it.
    vi.mocked(jsQR)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValue({ data: FISCAL } as ReturnType<typeof jsQR>);

    expect(await decodeQrFromFile(photo)).toBe(FISCAL);
    expect(vi.mocked(jsQR).mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('stops at the fiscal code instead of walking the rest of the ladder', async () => {
    installImage(400, 400);
    installCanvas(400);
    vi.mocked(jsQR).mockReturnValue({ data: FISCAL } as ReturnType<typeof jsQR>);

    expect(await decodeQrFromFile(photo)).toBe(FISCAL);
    expect(jsQR).toHaveBeenCalledTimes(1);
  });

  it('hands the main thread back between passes, so a batch can repaint while it reads', async () => {
    installImage(400, 400);
    installCanvas(400);
    vi.mocked(jsQR).mockReturnValue(null); // nothing anywhere: the whole ladder runs

    const order: string[] = [];
    const ladder = decodeQrFromFile(photo).then(() => order.push('ladder'));
    // A repaint is a MACROTASK. Queued here, it can only run before the ladder finishes if the
    // ladder actually yields to the event loop — `await Promise.resolve()` yields a MICROtask,
    // which the loop drains without ever painting, so «читаю 3 з 10» froze on the first number
    // and the phone read as hung for the whole sweep.
    setTimeout(() => order.push('paint'), 0);

    await ladder;
    expect(order[0]).toBe('paint');
  });

  it('reports the only code on the paper when none of them is fiscal', async () => {
    installImage(400, 400);
    installCanvas(400);
    vi.mocked(jsQR).mockReturnValue({ data: MARKETING } as ReturnType<typeof jsQR>);

    expect(await decodeQrFromFile(photo)).toBe(MARKETING);
  });
});
