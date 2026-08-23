import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { decodeQr, decodeQrFromFile, looksFiscal } from '@/lib/qr.ts';

/** How often a frame is decoded. Fast enough to feel instant, slow enough to leave the phone warm. */
const SCAN_INTERVAL_MS = 220;

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
 * <p>A code that is not a fiscal receipt is named as such on the spot and scanning continues: the
 * master is standing there with the phone up, and a round trip to be told «це не чек» would be
 * both slower and less clear. What actually parses is still the backend's call — this only decides
 * whether asking is worth the wait.</p>
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
  const [reading, setReading] = useState(false);

  // Held in a ref so a caller that re-creates the callback each render (the normal case for an
  // inline arrow) does not tear the camera down and back up mid-scan.
  const onScannedRef = useRef(onScanned);
  onScannedRef.current = onScanned;

  useEffect(() => {
    if (!open) return;
    setCamera('starting');
    setNotice(null);

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
          // Keep scanning — he is still holding the phone up at the paper.
          setNotice(t('qr.notFiscal'));
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
        // `ideal`, not `exact`: a laptop or a phone whose back camera is busy still gets a camera
        // instead of a hard failure, and the master can simply turn the device around.
        stream = await media.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
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
    try {
      const found = await decodeQrFromFile(file);
      if (!found) {
        setNotice(t('qr.noCodeInPhoto'));
        return;
      }
      if (!looksFiscal(found)) {
        setNotice(t('qr.notFiscal'));
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
          <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900" role="status">
            {notice}
          </p>
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
