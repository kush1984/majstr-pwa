import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { decodeQr, decodeQrFromFile, looksFiscal } from '@/lib/qr.ts';

/** How often a frame is decoded. Fast enough to feel instant, slow enough to leave the phone warm. */
const SCAN_INTERVAL_MS = 220;

/** Enough of the payload to recognise WHICH code was read, without wrapping the notice to five lines. */
const NOTICE_CODE_CHARS = 60;

interface FocusableVideoConstraints extends MediaTrackConstraints {
  /** Non-standard, honoured on Android: keep refocusing instead of locking on the first frame. */
  focusMode?: ConstrainDOMString;
}

/**
 * A fiscal QR is DENSE — around forty modules across, printed a couple of centimetres wide on
 * thermal paper. At the 640x480 a phone hands back when nothing is asked of it, its modules are
 * under two pixels and no decoder can read it, while the sparse vendor/marketing code beside it
 * reads fine — which is precisely the failure the master saw. So the resolution is asked for.
 * `ideal` throughout: a laptop webcam that cannot do this still opens instead of failing.
 */
const VIDEO: FocusableVideoConstraints = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  focusMode: { ideal: 'continuous' },
};

type Camera = 'starting' | 'live' | 'unavailable';

/**
 * Scan the QR printed on a fiscal receipt.
 *
 * <p>Live camera first — a QR is aimed at, not photographed — with a picked-photo fallback that is
 * not merely a courtesy: iOS Safari denies `getUserMedia` outright over plain http, a master may
 * have refused the camera permission once and never be asked again, and a receipt often already
 * lives in the gallery. So the fallback shows on every failure AND stays offered while the camera
 * runs.</p>
 *
 * <p>A code that is not a fiscal receipt is named as such on the spot — <b>with the payload it
 * actually read</b> — and scanning continues: the master is standing there with the phone up, and
 * a round trip to be told «це не чек» would be both slower and less clear. Showing what was read
 * matters because a receipt prints SEVERAL codes; «прочитано https://shorturl.at/…» tells him he
 * caught the shop's marketing code, where a bare «це не чек» reads as the feature being broken.
 * What actually parses is still the backend's call — this only decides whether asking is worth the
 * wait.</p>
 */
export function QrScanSheet({
  open,
  onClose,
  onScanned,
  title,
}: {
  open: boolean;
  onClose: () => void;
  /** The raw payload. The caller decides what to do with it (and closes the sheet). */
  onScanned: (payload: string) => void;
  title?: string;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState<Camera>('starting');
  const [notice, setNotice] = useState<string | null>(null);
  /** The non-fiscal payload behind the notice, so the master can see which code he caught. */
  const [readInstead, setReadInstead] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  // Held in a ref so a caller that re-creates the callback each render (the normal case for an
  // inline arrow) does not tear the camera down and back up mid-scan.
  const onScannedRef = useRef(onScanned);
  onScannedRef.current = onScanned;

  useEffect(() => {
    if (!open) return;
    setCamera('starting');
    setNotice(null);
    setReadInstead(null);

    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;

    const stop = () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };

    const tick = async () => {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.videoWidth > 0) {
        const found = await decodeQr(video, video.videoWidth, video.videoHeight);
        if (stopped) return;
        if (found) {
          if (looksFiscal(found)) {
            stop();
            onScannedRef.current(found);
            return;
          }
          // Keep scanning — he is still holding the phone up at the paper, and the fiscal code is
          // usually a few centimetres from whatever this was.
          setNotice(t('qr.notFiscal'));
          setReadInstead(found.slice(0, NOTICE_CODE_CHARS));
        }
      }
      timer = window.setTimeout(() => void tick(), SCAN_INTERVAL_MS);
    };

    const start = async () => {
      const media = navigator.mediaDevices;
      if (!media?.getUserMedia) {
        setCamera('unavailable');
        return;
      }
      try {
        stream = await media.getUserMedia({ video: VIDEO });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined); // autoplay refusal is not fatal
        }
        setCamera('live');
        void tick();
      } catch {
        // Denied, in use, or no camera at all — all one outcome for the master: use a photo.
        setCamera('unavailable');
      }
    };

    void start();
    return stop;
  }, [open, t]);

  const onPickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setNotice(null);
    setReadInstead(null);
    try {
      // The decoder has already walked its whole preprocessing ladder looking for a fiscal code
      // here, so a non-fiscal answer is final: there is nothing left to try on this photo.
      const found = await decodeQrFromFile(file);
      if (!found) {
        setNotice(t('qr.noCodeInPhoto'));
        return;
      }
      if (!looksFiscal(found)) {
        setNotice(t('qr.notFiscal'));
        setReadInstead(found.slice(0, NOTICE_CODE_CHARS));
        return;
      }
      onScannedRef.current(found);
    } finally {
      setReading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title ?? t('qr.title')}>
      <div className="space-y-3">
        {camera !== 'unavailable' && (
          <div className="relative overflow-hidden rounded-xl bg-black">
            {/* aspect-square keeps the viewfinder the same size on every phone and leaves the
                buttons below it inside the thumb zone on a 375px screen. */}
            <video
              ref={videoRef}
              className="aspect-square w-full object-cover"
              playsInline
              muted
              autoPlay
            />
            {/* An aiming frame, not a crop: the whole frame is decoded, this only tells the master
                where to point. */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-2/3 w-2/3 rounded-xl border-2 border-white/80" />
            </div>
            {camera === 'starting' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white">
                <Spinner />
              </div>
            )}
          </div>
        )}

        <p className="text-sm text-muted">
          {camera === 'unavailable' ? t('qr.cameraBlocked') : t('qr.hint')}
        </p>

        {notice && (
          <div className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900" role="status">
            <p>{notice}</p>
            {readInstead && (
              // `break-all` because a payload is one unbroken token: without it a 375px screen
              // scrolls sideways, which is the one thing a sheet must never do.
              <p className="mt-1 break-all font-mono text-xs opacity-80">
                {t('qr.readInstead', { code: readInstead })}
              </p>
            )}
          </div>
        )}

        {/* Offered in BOTH states: the camera running does not mean it is the easier path here. */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void onPickPhoto(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <Button fullWidth variant="secondary" loading={reading} onClick={() => fileRef.current?.click()}>
          🖼 {t('qr.pickPhoto')}
        </Button>
      </div>
    </Modal>
  );
}
