import jsQR from 'jsqr';

/**
 * Reading a QR code out of a video frame or a still photo.
 *
 * <p>Two decoders, and the choice matters: Chrome and Android WebView ship a native
 * `BarcodeDetector` that decodes on the GPU and finds a code the JS scanner misses at an angle,
 * while iOS Safari — where a good half of a Ukrainian master's phones live — has none. So the
 * native one is preferred and `jsqr` is the fallback, not the other way round.</p>
 *
 * <p>Everything here is pure input → `string | null`. Nothing owns a camera, which is what makes it
 * testable: the scanner component wires the frames, this decides what they say.</p>
 */

/** The slice of the (still non-standard) BarcodeDetector API we use. */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorCtor {
  new (init?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

function nativeCtor(): BarcodeDetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
}

let native: BarcodeDetectorLike | null | undefined;

/** The native detector, constructed once, or null where the browser has none. */
function detector(): BarcodeDetectorLike | null {
  if (native !== undefined) return native;
  const ctor = nativeCtor();
  try {
    native = ctor ? new ctor({ formats: ['qr_code'] }) : null;
  } catch {
    // Some builds expose the constructor but reject the format list. Fall back rather than throw.
    native = null;
  }
  return native;
}

/** Test seam: forget the cached detector so a test can install its own (or none). */
export function resetQrDecoder(): void {
  native = undefined;
}

/**
 * Decode a QR code from anything drawable, or null when the frame holds none.
 *
 * <p>A frame with no code is the NORMAL case — this runs many times a second while the master aims
 * the phone — so a miss is a null, never an exception, and a decoder that throws is treated as a
 * miss too: one bad frame must not end a scan.</p>
 */
export async function decodeQr(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<string | null> {
  if (width <= 0 || height <= 0) return null;

  const detect = detector();
  if (detect) {
    try {
      const found = await detect.detect(source);
      const value = found.find((b) => b.rawValue)?.rawValue;
      if (value) return value;
    } catch {
      // A detector that throws on this frame is a miss; jsqr still gets its turn below.
    }
  }

  const data = pixels(source, width, height);
  if (!data) return null;
  // `dontInvert` is the default; receipts print black-on-white, and asking jsqr to also try the
  // inverted image doubles the per-frame cost for a case that does not occur on paper.
  return jsQR(data.data, data.width, data.height)?.data ?? null;
}

/** RGBA pixels for jsqr, or null when this environment has no 2D canvas (jsdom, mostly). */
function pixels(source: CanvasImageSource, width: number, height: number): ImageData | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  } catch {
    return null;
  }
}

/**
 * Decode a QR from a picked image file — the fallback path when the camera is unavailable or the
 * master already has the receipt in his gallery.
 */
export async function decodeQrFromFile(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await load(url);
    return await decodeQr(img, img.naturalWidth, img.naturalHeight);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = url;
  });
}

/**
 * Does this payload look like a fiscal receipt's code at all?
 *
 * <p>A cheap client-side pre-check so a QR that is plainly something else — a Wi-Fi config, a
 * payment link, a parcel tracker — is named as such immediately instead of after a round trip. The
 * BACKEND is the authority on what parses; this only decides whether asking it is worth the wait,
 * so it is deliberately loose: the four fields the lookup needs, in any order, any case.</p>
 */
export function looksFiscal(payload: string): boolean {
  const q = payload.toLowerCase();
  return /(^|[?&])fn=/.test(q) && /[?&]id=/.test(q) && /[?&]sm=/.test(q) && /[?&]date=/.test(q);
}
