import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { toast } from '@/hooks/useToast.ts';
import { useOnlineGuard } from '@/hooks/useOnlineGuard.ts';
import { toAppError } from '@/api/errors.ts';
import { downscaleImage } from '@/lib/image.ts';
import { cn } from '@/lib/cn.ts';
import { LENGTH_UNITS, type LengthUnit } from '@/lib/shapes.ts';
import { sketchImportApi } from '@/api/sketchImport.ts';
import { photosApi } from '@/api/photos.ts';
import { MeasurementItemForm } from './MeasurementItemForm.tsx';
import { MEASUREMENTS_KEY } from './useMeasurements.ts';
import type {
  Confidence,
  MeasurementItem,
  MeasurementItemRequest,
  SketchParseResponse,
} from '@/api/types.ts';

const MAX_BYTES = 10 * 1024 * 1024;

interface ItemDraft {
  key: number;
  initial: MeasurementItem; // seeds MeasurementItemForm (which recomputes the result itself)
  confidence: Confidence;
  note: string | null;
  req: MeasurementItemRequest | null; // streamed live from the form; null until valid
}
interface RoomDraft {
  key: number;
  name: string;
  confidence: Confidence;
  items: ItemDraft[];
}

type Step = 'source' | 'parsing' | 'review';

/**
 * Recognise a hand-drawn room sketch into measurements (PRO). Camera/upload → Claude vision →
 * a REVIEW screen where the sketch photo sits above OUR redrawn schema for each element, so the
 * master compares two drawings at a glance (the guard against a plausible-but-misassigned size).
 * Nothing is created until the master confirms; the server recomputes every result.
 */
export function SketchReviewSheet({
  open,
  onClose,
  objectId,
}: {
  open: boolean;
  onClose: () => void;
  objectId: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { online } = useOnlineGuard(); // LLM recognition is server-side — no offline path
  const [step, setStep] = useState<Step>('source');
  const [rooms, setRooms] = useState<RoomDraft[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [unit, setUnit] = useState<LengthUnit>('M');
  const [committing, setCommitting] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [savePhotoOpen, setSavePhotoOpen] = useState(false);
  const heldFile = useRef<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const keySeq = useRef(0);

  const reset = useCallback(() => {
    setStep('source');
    setRooms([]);
    setWarnings([]);
    setUnit('M');
    setCommitting(false);
    setZoom(false);
    setSavePhotoOpen(false);
    heldFile.current = null;
    setPhotoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  const close = () => {
    reset();
    onClose();
  };

  const buildDrafts = (res: SketchParseResponse): RoomDraft[] =>
    res.rooms.map((room) => ({
      key: keySeq.current++,
      name: room.name,
      confidence: room.confidence,
      items: room.items.map((it) => ({
        key: keySeq.current++,
        confidence: it.confidence,
        note: it.note,
        req: null,
        initial: {
          id: `sketch-${keySeq.current}`,
          name: it.name,
          type: it.type,
          unit: it.unit,
          result: it.result ?? 0,
          payload: it.payload,
          sortOrder: 0,
        },
      })),
    }));

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    // Recognition runs on the server (Claude vision) — impossible offline; say so up front.
    if (!online) {
      toast.error(t('offline.needConnection'));
      return;
    }
    if (!/^image\/(png|jpeg|jpg|webp)$/.test(file.type)) {
      toast.error(t('photos.badType'));
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(t('photos.tooLarge'));
      return;
    }
    heldFile.current = file;
    setPhotoUrl(URL.createObjectURL(file));
    setStep('parsing');
    try {
      const res = await sketchImportApi.parse(objectId, file);
      setRooms(buildDrafts(res));
      setWarnings(res.warnings);
      setUnit(res.unitGuess === 'MM' ? 'MM' : res.unitGuess === 'CM' ? 'CM' : 'M');
      setStep('review');
    } catch (err) {
      toast.error(toAppError(err).message);
      reset();
    }
  };

  // Stable dispatcher — the review item memoises its own callback off this, so the form's
  // live-change effect doesn't re-fire on every parent render (would loop).
  const onItemChange = useCallback(
    (roomKey: number, itemKey: number, req: MeasurementItemRequest | null) => {
      setRooms((prev) =>
        prev.map((room) =>
          room.key !== roomKey
            ? room
            : { ...room, items: room.items.map((it) => (it.key === itemKey ? { ...it, req } : it)) },
        ),
      );
    },
    [],
  );

  const removeItem = (roomKey: number, itemKey: number) =>
    setRooms((prev) =>
      prev.map((room) =>
        room.key !== roomKey ? room : { ...room, items: room.items.filter((it) => it.key !== itemKey) },
      ),
    );

  const removeRoom = (roomKey: number) => setRooms((prev) => prev.filter((r) => r.key !== roomKey));

  const renameRoom = (roomKey: number, name: string) =>
    setRooms((prev) => prev.map((r) => (r.key === roomKey ? { ...r, name } : r)));

  const roomsWithItems = rooms.filter((r) => r.items.length > 0);
  const totalItems = roomsWithItems.reduce((s, r) => s + r.items.length, 0);
  const invalidCount = roomsWithItems.reduce(
    (s, r) => s + r.items.filter((it) => it.req == null || !r.name.trim()).length,
    0,
  );

  const commit = async () => {
    setCommitting(true);
    try {
      const tree = await sketchImportApi.commit(objectId, {
        rooms: roomsWithItems.map((room) => ({
          name: room.name.trim(),
          items: room.items.map((it) => it.req).filter((r): r is MeasurementItemRequest => r != null),
        })),
      });
      qc.setQueryData(MEASUREMENTS_KEY(objectId), tree);
      toast.success(t('sketch.added', { rooms: roomsWithItems.length, items: totalItems }));
      setSavePhotoOpen(true);
    } catch (err) {
      toast.error(toAppError(err).message);
      setCommitting(false);
    }
  };

  const saveSketchPhoto = async (save: boolean) => {
    setSavePhotoOpen(false);
    if (save && heldFile.current) {
      try {
        const compact = await downscaleImage(heldFile.current);
        await photosApi.upload(objectId, compact, { source: 'MANUAL', caption: t('sketch.photoCaption') });
        void qc.invalidateQueries({ queryKey: ['project-photos', objectId] });
        toast.success(t('sketch.photoSaved'));
      } catch (err) {
        toast.error(toAppError(err).message); // fail-soft — the measurements already committed
      }
    }
    close();
  };

  return (
    <>
      <Modal open={open} onClose={close} title={t('sketch.title')} size="lg">
        {step === 'source' && (
          <div className="space-y-3">
            <p className="text-sm text-muted">{t('sketch.sourceHint')}</p>
            <Button fullWidth onClick={() => cameraRef.current?.click()}>📷 {t('sketch.takePhoto')}</Button>
            <Button fullWidth variant="secondary" onClick={() => uploadRef.current?.click()}>
              🖼 {t('sketch.upload')}
            </Button>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ''; }} />
            <input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
              onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        )}

        {step === 'parsing' && (
          <div className="py-10 text-center">
            <Spinner size="lg" />
            <p className="mt-3 text-sm text-muted">{t('sketch.parsing')}</p>
          </div>
        )}

        {step === 'review' && (
          rooms.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted">{t('sketch.nothingFound')}</p>
              <Button className="mt-4" variant="secondary" onClick={reset}>{t('sketch.tryAgain')}</Button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* The sketch photo — compare it against our schemas below. */}
              {photoUrl && (
                <button type="button" onClick={() => setZoom(true)} className="block w-full">
                  <img src={photoUrl} alt={t('sketch.title')}
                    className="max-h-52 w-full rounded-xl border border-border object-contain bg-surface-sunken" />
                  <span className="mt-1 block text-center text-xs text-muted">{t('sketch.photoTap')}</span>
                </button>
              )}

              {warnings.length > 0 && (
                <div className="rounded-xl bg-amber-soft p-3 text-xs text-amber">
                  <ul className="list-disc space-y-0.5 pl-4">
                    {warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}

              <p className="text-sm text-muted">{t('sketch.reviewHint')}</p>

              {/* One unit dial for the whole sheet (surfaces reinterpret; the guess is fixable). */}
              <div className="flex items-center justify-center gap-1.5">
                <span className="text-xs text-muted">{t('sketch.unitHint')}:</span>
                {LENGTH_UNITS.map((u) => (
                  <button key={u} type="button" onClick={() => setUnit(u)}
                    className={cn('min-h-[40px] rounded-lg border px-3 text-xs font-semibold transition-colors',
                      unit === u ? 'border-brand bg-brand-soft text-brand' : 'border-border text-muted')}>
                    {t(`lengthUnit.${u}`)}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                {rooms.map((room) => (
                  <div key={room.key} className="rounded-card border border-border bg-surface p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <Input value={room.name} placeholder={t('sketch.roomNamePlaceholder')}
                        onChange={(e) => renameRoom(room.key, e.target.value)} className="flex-1" maxLength={255} />
                      <button type="button" aria-label={t('sketch.deleteRoom')} className="px-1 text-muted"
                        onClick={() => removeRoom(room.key)}>🗑</button>
                    </div>
                    <div className="space-y-3">
                      {room.items.map((item) => (
                        <SketchReviewItem
                          key={item.key}
                          roomKey={room.key}
                          item={item}
                          hostUnit={unit}
                          onChange={onItemChange}
                          onDelete={() => removeItem(room.key, item.key)}
                        />
                      ))}
                      {room.items.length === 0 && (
                        <p className="text-xs text-muted">{t('sketch.roomEmpty')}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {invalidCount > 0 && (
                <p className="text-center text-xs text-amber">{t('sketch.fixFirst', { count: invalidCount })}</p>
              )}
              <Button fullWidth loading={committing} disabled={totalItems === 0 || invalidCount > 0}
                onClick={() => void commit()}>
                {t('sketch.commit', { count: totalItems })}
              </Button>
            </div>
          )
        )}
      </Modal>

      {/* Fullscreen sketch for a close look. */}
      {zoom && photoUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setZoom(false)}>
          <img src={photoUrl} alt={t('sketch.title')} className="max-h-full max-w-full object-contain" />
        </div>
      )}

      <ConfirmDialog
        open={savePhotoOpen}
        title={t('sketch.savePhotoTitle')}
        message={t('sketch.savePhotoMessage')}
        confirmLabel={t('sketch.savePhotoYes')}
        onConfirm={() => void saveSketchPhoto(true)}
        onClose={() => void saveSketchPhoto(false)}
      />
    </>
  );
}

/** One reviewed element: confidence flag + note + delete, wrapping the shared editor. Memoises
 *  a stable onLiveChange off the parent's dispatcher so the editor's live effect can't loop. */
function SketchReviewItem({
  roomKey,
  item,
  hostUnit,
  onChange,
  onDelete,
}: {
  roomKey: number;
  item: ItemDraft;
  hostUnit: LengthUnit;
  onChange: (roomKey: number, itemKey: number, req: MeasurementItemRequest | null) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const flagged = item.confidence !== 'high';
  const onLive = useCallback(
    (req: MeasurementItemRequest | null) => onChange(roomKey, item.key, req),
    [onChange, roomKey, item.key],
  );

  return (
    <div className={cn('rounded-xl border p-3', flagged ? 'border-amber-400 bg-amber-soft' : 'border-border bg-surface-sunken')}>
      <div className="mb-1 flex items-center justify-between gap-2">
        {flagged && (
          <span className="rounded-full bg-amber px-2 py-0.5 text-[11px] font-semibold text-white">
            {t('sketch.needsAttention')}
          </span>
        )}
        <button type="button" aria-label={t('sketch.deleteItem')} className="ml-auto px-1 text-muted"
          onClick={onDelete}>🗑</button>
      </div>
      {item.note && <p className="mb-2 text-xs text-amber">{item.note}</p>}
      <MeasurementItemForm
        initial={item.initial}
        hostUnit={item.initial.type === 'SURFACE' ? hostUnit : undefined}
        onLiveChange={onLive}
        onSave={() => {}}
        onCancel={() => {}}
      />
    </div>
  );
}
