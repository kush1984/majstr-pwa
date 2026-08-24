import jsQR from 'jsqr';

/**
 * Reading a QR code out of a video frame or a still photo.
 *
 * <p>Two decoders, and the choice matters: Chrome and Android WebView ship a native
 * `BarcodeDetector` that decodes on the GPU and finds a code the JS scanner misses at an angle,
 * while iOS Safari — where a good half of a Ukrainian master's phones live — has none. So the
 * native one is preferred and `jsqr` is the fallback, not the other way round.</p>
 *
 * <p><b>A receipt carries MORE THAN ONE code, and the fiscal one is the hard one.</b> That is the
 * lesson of the first two real receipts: beside the fiscal QR the paper also prints the register
 * vendor's own code, a marketing link, a loyalty code — all of them short payloads in a sparse,
 * high-contrast code any decoder reads instantly, while the fiscal one is dense and printed small
 * on curling thermal paper. Take "the first code found" and the master is told this is not a
 * fiscal receipt code about a code he never aimed at. So every decode here collects EVERY code it
 * can see and returns a fiscal one when there is one; a non-fiscal payload is only ever the answer
 * when it is the only thing on the paper.</p>
 *
 * <p>The second lesson: on a photo, a plain `jsqr` pass over the raw pixels finds the sparse codes
 * and misses the dense one, while the same photo run through an adaptive threshold decodes it. So
 * the still-photo path is a short ladder of preprocessing passes rather than one attempt, and it
 * stops the moment something fiscal appears.</p>
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

/** Longest side a picked photo is worked at: a 12 MP shot costs seconds a pass and gains nothing. */
const MAX_PHOTO_SIDE = 2400;

/**
 * How long the still-photo ladder may spend before giving up.
 *
 * <p>Measured, not guessed: on a 3072x4096 photo the full ladder is 141 `jsqr` calls and takes ~29 s
 * on a desktop — several times that on a phone, which is not a wait, it is a hang. The pass that
 * actually decodes a receipt is the FIRST one (~3 s there), so the budget buys the passes that pay
 * and abandons the tail. A photo whose code needs more than this is a photo to retake closer.</p>
 */
const SWEEP_BUDGET_MS = 6000;

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
 * Every code the native detector sees in this frame — all of them, because picking among them is
 * the caller's job. Empty where the browser has no detector, the detector throws, or nothing is in
 * view.
 */
async function nativeAll(source: CanvasImageSource): Promise<string[]> {
  const detect = detector();
  if (!detect) return [];
  try {
    const found = await detect.detect(source);
    return found.map((code) => code.rawValue).filter(Boolean);
  } catch {
    // A detector that throws on this frame is a miss; jsqr still gets its turn.
    return [];
  }
}

/**
 * Decode a QR code from anything drawable, or null when the frame holds none.
 *
 * <p>A frame with no code is the NORMAL case — this runs many times a second while the master aims
 * the phone — so a miss is a null, never an exception, and a decoder that throws is treated as a
 * miss too: one bad frame must not end a scan.</p>
 *
 * <p>Cheap by design, in the order the cost rises. The adaptive pass runs ONLY once some code has
 * already decoded and it was not fiscal: that is the frame where the paper is demonstrably in view
 * and the code we want is the one that did not decode, which is the only frame worth the extra
 * pass.</p>
 */
export async function decodeQr(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<string | null> {
  if (width <= 0 || height <= 0) return null;

  const fromNative = preferFiscal(await nativeAll(source));
  if (fromNative && looksFiscal(fromNative)) return fromNative;

  const data = pixels(source, width, height);
  if (!data) return fromNative;

  // `dontInvert` is the default; receipts print black-on-white, and asking jsqr to also try the
  // inverted image doubles the per-frame cost for a case that does not occur on paper.
  const plain = scan(data);
  if (plain && looksFiscal(plain)) return plain;

  const other = fromNative ?? plain;
  if (other) {
    const deep = scan(adaptive(data, radiusFor(data), 1.05));
    if (deep && looksFiscal(deep)) return deep;
  }
  return other;
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
 *
 * <p>This one is allowed to be slow. It is a single deliberate act with a spinner in front of it,
 * not one frame among thirty, so it walks the whole ladder: the native detector, a plain pass, then
 * adaptive thresholds at a few radii, then those same thresholds over overlapping tiles — a dense
 * code that is a fifth of the frame is a comfortable size once the tile around it is all jsqr is
 * given. It stops at the first fiscal payload, and returns a non-fiscal one only when nothing
 * fiscal was found anywhere.</p>
 */
export async function decodeQrFromFile(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await load(url);
    const fromNative = preferFiscal(await nativeAll(img));
    if (fromNative && looksFiscal(fromNative)) return fromNative;

    const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const data = pixels(
      img,
      Math.round(img.naturalWidth * scale),
      Math.round(img.naturalHeight * scale),
    );
    if (!data) return fromNative;
    return sweep(data) ?? fromNative;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The preprocessing ladder over one still image: plain, then adaptive full-frame, then adaptive
 * tiles. Returns a fiscal payload as soon as one appears, else whatever else it found.
 */
function sweep(data: ImageData): string | null {
  let other = scan(data);
  if (other && looksFiscal(other)) return other;

  const radius = radiusFor(data);
  // Radius before bias: the window size decides whether a module is compared against its
  // neighbours or against half the receipt, and the bias only nudges the edge afterwards.
  const passes: [number, number][] = [
    [radius, 1.05],
    [radius, 1],
    [radius * 2, 1.05],
    [radius * 2, 1],
  ];
  const until = Date.now() + SWEEP_BUDGET_MS;
  for (const [window, bias] of passes) {
    const binary = adaptive(data, window, bias);
    for (const candidate of candidates(binary)) {
      const found = scan(candidate);
      if (found) {
        if (looksFiscal(found)) return found;
        other ??= found;
      }
      if (Date.now() > until) return other;
    }
  }
  return other;
}

/** The whole frame first, then its tiles — lazily, so 30-odd full-size tiles never coexist in memory. */
function* candidates(binary: ImageData): Generator<ImageData> {
  yield binary;
  yield* tiles(binary);
}

/** Overlapping halves and thirds: a code straddling one tile's edge still lands whole in a neighbour. */
function* tiles(data: ImageData): Generator<ImageData> {
  for (const n of [2, 3]) {
    const tw = Math.floor(data.width / n);
    const th = Math.floor(data.height / n);
    if (tw < 60 || th < 60) continue;
    for (let y = 0; y + th <= data.height; y += Math.floor(th / 2)) {
      for (let x = 0; x + tw <= data.width; x += Math.floor(tw / 2)) {
        yield crop(data, x, y, tw, th);
      }
    }
  }
}

function crop(data: ImageData, x0: number, y0: number, w: number, h: number): ImageData {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const from = ((y0 + y) * data.width + x0) * 4;
    out.set(data.data.subarray(from, from + w * 4), y * w * 4);
  }
  return { data: out, width: w, height: h, colorSpace: 'srgb' };
}

function scan(data: ImageData): string | null {
  try {
    return jsQR(data.data, data.width, data.height)?.data ?? null;
  } catch {
    // jsqr is picky about some sizes; a refusal is a miss like any other.
    return null;
  }
}

/** A window of roughly a sixtieth of the frame — a few QR modules wide at the sizes paper prints. */
function radiusFor(data: ImageData): number {
  return Math.min(40, Math.max(6, Math.round(Math.min(data.width, data.height) / 60)));
}

/**
 * Threshold each pixel against the mean of its neighbourhood instead of against one global level.
 *
 * <p>This is what makes a dense fiscal code readable at all: thermal paper is grey, it curls, and
 * it catches the room light unevenly, so one half of the code is darker than the other half's
 * white. A summed-area table keeps the neighbourhood mean O(1) per pixel, so the radius costs
 * nothing and a full pass over a 2400px photo stays in the tens of milliseconds.</p>
 */
function adaptive(data: ImageData, radius: number, bias: number): ImageData {
  const w = data.width;
  const h = data.height;
  const grey = new Float32Array(w * h);
  for (let i = 0, p = 0; p < grey.length; i += 4, p++) {
    grey[p] = data.data[i] * 0.299 + data.data[i + 1] * 0.587 + data.data[i + 2] * 0.114;
  }
  const sums = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      run += grey[y * w + x];
      sums[(y + 1) * (w + 1) + x + 1] = sums[y * (w + 1) + x + 1] + run;
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h - 1, y + radius);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w - 1, x + radius);
      const total =
        sums[(y1 + 1) * (w + 1) + x1 + 1] -
        sums[y0 * (w + 1) + x1 + 1] -
        sums[(y1 + 1) * (w + 1) + x0] +
        sums[y0 * (w + 1) + x0];
      const mean = total / ((x1 - x0 + 1) * (y1 - y0 + 1));
      const value = grey[y * w + x] < mean * bias ? 0 : 255;
      const at = (y * w + x) * 4;
      out[at] = value;
      out[at + 1] = value;
      out[at + 2] = value;
      out[at + 3] = 255;
    }
  }
  return { data: out, width: w, height: h, colorSpace: 'srgb' };
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
 * The fiscal payload among several, or the first one when none of them is fiscal.
 *
 * <p>Never null when there were codes at all: a non-fiscal payload is worth returning so the
 * scanner can name what it actually read, which is the difference between "wrong code, aim lower"
 * and a scan that appears to do nothing.</p>
 */
function preferFiscal(values: string[]): string | null {
  return values.find(looksFiscal) ?? values[0] ?? null;
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
