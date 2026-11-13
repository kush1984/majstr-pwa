import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Select } from '@/components/Select.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { formatNumber } from '@/lib/format.ts';
import { parseDecimal } from '@/lib/decimal.ts';
import { routes } from '@/lib/config.ts';
import type { LayoutPattern, LayoutStart } from '@/lib/tileLayout.ts';
import { useEstimate } from '@/features/estimate/useEstimate.ts';
import { MEASUREMENTS_KEY, useMeasurementActions, useMeasurements } from '@/features/measurements/useMeasurements.ts';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal.tsx';
import { useMe } from '@/features/auth/useMe.ts';
import { TEMP_FREE_GETS_MEASUREMENTS_AND_ECONOMY } from '@/features/plan/tempFreeUnlocks.ts';
import type { MeasurementsResponse } from '@/api/types.ts';
import { TileLayoutDrawing } from './TileLayoutDrawing.tsx';
import { useTileLayoutActions, useTileLayouts } from './useTileLayouts.ts';
import {
  canSave,
  clampOpening,
  DEFAULT_JOINT,
  evaluate,
  floor,
  formatFromName,
  fromStored,
  isTilingLine,
  laidTile,
  lineIsFloor,
  measurementItems,
  mmToMetres,
  readAsMm,
  roomSurfaces,
  sizeToMm,
  shouldOfferMeasurements,
  STANDARD_FORMATS,
  surfacesFromMeasurements,
  toRequest,
  wall,
  type LayoutDraft,
  type SurfaceDraft,
  type SurfaceResult,
} from './tileLayoutModel.ts';

const PATTERNS: LayoutPattern[] = ['STRAIGHT', 'OFFSET_1_2', 'OFFSET_1_3', 'OFFSET_1_4'];
const STARTS: LayoutStart[] = ['AUTO', 'SYMMETRIC', 'CORNER', 'CENTER', 'MANUAL'];
const NUDGE_MM = 5;

/**
 * «Розкласти плитку» (iteration-tile-layout, stage 3) — one tiling line, its surfaces, and what the
 * layout buys. Works with no signal: the engine runs on the phone and «Готово» queues the save.
 * The work line itself is never changed here.
 */
export function TileLayoutPage() {
  const { id = '', itemId = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const back = (location.state as { from?: string } | null)?.from ?? routes.estimate(id);

  const estimate = useEstimate(id);
  const item = estimate.data?.items.find((i) => i.id === itemId);
  const stored = useTileLayouts(id);
  const storedView = stored.data?.find((v) => v.estimateItemId === itemId);
  const refs = useMemo(() => item?.measurementRefs ?? [], [item?.measurementRefs]);
  const { data: me } = useMe();
  // Measurements are a PRO feature (temporarily open to FREE) — never offer a write the server refuses.
  const measurementsAllowed = TEMP_FREE_GETS_MEASUREMENTS_AND_ECONOMY || (me?.plan ?? 'FREE') !== 'FREE';
  // Read even when the line names none: the object's own sizes are offered with one tap.
  const measurements = useMeasurements(estimate.data?.projectId ?? '', refs.length > 0 || measurementsAllowed);
  const { save, remove } = useTileLayoutActions(id);
  const qc = useQueryClient();
  const objectId = estimate.data?.projectId ?? '';
  const measurementActions = useMeasurementActions(objectId);
  const [offer, setOffer] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [keeping, setKeeping] = useState(false);
  const [draft, setDraft] = useState<LayoutDraft | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);

  // Seed once: the stored layout, else the measurements, else only the format the line names.
  useEffect(() => {
    if (seeded || !item || stored.isLoading || (refs.length > 0 && measurements.isLoading)) return;
    const fromRow = storedView ? fromStored(storedView) : null;
    if (fromRow) {
      setDraft(fromRow);
    } else {
      const format = formatFromName(item.name);
      const m = refs.length > 0 && measurements.data
        ? surfacesFromMeasurements(measurements.data.rooms.flatMap((r) => r.items), refs)
        : null;
      if (format && m && m.surfaces.length > 0) {
        setDraft({
          version: 1, format, orientation: 'LANDSCAPE', joint: DEFAULT_JOINT, surfaces: m.surfaces, unplaced: m.unplaced,
          fromMeasurements: true,
        });
      } else if (format) {
        setDraft({ version: 1, format, orientation: 'LANDSCAPE', joint: DEFAULT_JOINT, surfaces: [], unplaced: m?.unplaced ?? [] });
      }
    }
    setSeeded(true);
  }, [seeded, item, stored.isLoading, storedView, refs, measurements.isLoading, measurements.data]);

  const result = useMemo(() => (draft ? evaluate(draft, item?.quantity ?? 0) : null), [draft, item?.quantity]);
  const objectSurfaces = useMemo(() => {
    if (!measurements.data) return [];
    return measurements.data.rooms.flatMap((room) => room.items
      .filter((i) => i.type === 'SURFACE')
      .flatMap((i) => surfacesFromMeasurements([i], [i.id]).surfaces
        .map((surface) => ({ surface: { ...surface, name: `${room.name} · ${surface.name}` } }))));
  }, [measurements.data]);
  const floorLine = item ? lineIsFloor(item.name) : false;

  if (estimate.isLoading) {
    return <div className="flex justify-center py-16"><Spinner /></div>;
  }
  if (!item || !isTilingLine(item)) {
    return <EmptyState icon="🧱" title={t('tileLayout.notTilingTitle')} text={t('tileLayout.notTilingText')} />;
  }
  if (!seeded) {
    return <div className="flex justify-center py-16"><Spinner /></div>;
  }

  const update = (fn: (d: LayoutDraft) => LayoutDraft) => setDraft((d) => (d ? fn(d) : d));
  const setSurface = (key: string, patch: Partial<SurfaceDraft>) =>
    update((d) => ({ ...d, surfaces: d.surfaces.map((s) => (s.key === key ? { ...s, ...patch } : s)) }));

  const onSave = async () => {
    if (!draft || !result || !canSave(result)) return;
    try {
      await save.mutateAsync({ itemId, req: toRequest(draft, result) });
      toast.success(t('tileLayout.saved'));
      // Stage 4: sizes typed here may go into the object's measurements — asked, never assumed.
      if (objectId && measurementsAllowed && shouldOfferMeasurements(draft, storedView?.measurementsDeclined ?? false)) {
        setRoomName(estimate.data?.name?.trim() || t('tileLayout.roomDefault'));
        setOffer(true);
        return;
      }
      void navigate(back);
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  /** «Ні»: remembered on the line, so the question is not asked again. */
  const declineMeasurements = async () => {
    setOffer(false);
    if (draft && result) {
      try {
        await save.mutateAsync({ itemId, req: toRequest(draft, result, true) });
      } catch {
        // The layout is saved; only the «do not ask again» mark was lost — he may be asked once more.
      }
    }
    void navigate(back);
  };

  /** «Зберегти в заміри»: a room with the walls and the floor as SURFACE elements, offline-safe. */
  const keepMeasurements = async () => {
    if (!draft || !result) return;
    setKeeping(true);
    try {
      const before = new Set((qc.getQueryData<MeasurementsResponse>(MEASUREMENTS_KEY(objectId))?.rooms ?? []).map((r) => r.id));
      const tree = await measurementActions.addRoom.mutateAsync({ name: roomName.trim() || t('tileLayout.roomDefault') });
      const room = tree.rooms.find((r) => !before.has(r.id)) ?? tree.rooms[tree.rooms.length - 1];
      for (const req of measurementItems(draft, { walls: t('tileLayout.measuredWalls'), floor: t('tileLayout.floorName') })) {
        await measurementActions.addItem.mutateAsync({ roomId: room.id, req });
      }
      const kept: LayoutDraft = { ...draft, savedToMeasurements: true };
      setDraft(kept);
      await save.mutateAsync({ itemId, req: toRequest(kept, result) });
      toast.success(t('tileLayout.measurementsSaved'));
      setOffer(false);
      void navigate(back);
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setKeeping(false);
    }
  };

  const onForget = async () => {
    setConfirmForget(false);
    try {
      await remove.mutateAsync(itemId);
      toast.success(t('tileLayout.forgotten'));
      void navigate(back);
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  return (
    <div className="min-h-dvh bg-canvas pb-48">
      <div className="mx-auto max-w-xl px-4 pt-4 sm:px-6">
        <div className="mb-4 flex items-center gap-3">
          <button type="button" onClick={() => void navigate(back)} aria-label={t('common.back')}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-lg text-primary">
            ←
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-extrabold tracking-tight text-primary">{item.name}</h1>
            <p className="truncate text-xs text-muted">
              {t('tileLayout.lineSub', { qty: formatNumber(item.quantity, 3) })}
            </p>
          </div>
        </div>

        {storedView?.paused && (
          <p className="mb-3 rounded-card bg-amber-soft px-3 py-2 text-xs text-amber-strong">
            {t('tileLayout.pausedText', { format: `${storedView.tileShortMm}×${storedView.tileLongMm}` })}
          </p>
        )}

        <FormatPicker
          format={draft?.format ?? null}
          orientation={draft?.orientation ?? 'LANDSCAPE'}
          joint={draft?.joint ?? DEFAULT_JOINT}
          onFormat={(format) => setDraft((d) => (d ? { ...d, format } : {
            version: 1, format, orientation: 'LANDSCAPE', joint: DEFAULT_JOINT, surfaces: [], unplaced: [],
          }))}
          onOrientation={(orientation) => update((d) => ({ ...d, orientation }))}
          onJoint={(joint) => update((d) => ({ ...d, joint }))}
        />

        {draft && draft.surfaces.length === 0 && (
          <ShapeChooser
            lineM2={item.quantity}
            floorLine={floorLine}
            fromObject={[...objectSurfaces].sort((a, b) => Number(b.surface.floor === floorLine) - Number(a.surface.floor === floorLine))
              .map((o) => o.surface)}
            onRoom={(surfaces) => update((d) => ({ ...d, surfaces }))}
            onSurface={(surface) => update((d) => ({ ...d, surfaces: [surface] }))}
            onSurfaces={() => update((d) => ({
              ...d, surfaces: [floorLine ? floor(t('tileLayout.floorName')) : wall(t('tileLayout.wallName', { n: 1 }))],
            }))}
            onByArea={() => void navigate(back)}
          />
        )}

        {draft && draft.surfaces.length > 0 && result && (
          <div className="space-y-3">
            {draft.unplaced.length > 0 && (
              <p className="rounded-card bg-amber-soft px-3 py-2 text-xs text-amber-strong">
                {t('tileLayout.unplacedText', { n: draft.unplaced.length })}
              </p>
            )}
            {draft.surfaces.map((s) => (
              <SurfaceCard
                key={s.key}
                draft={draft}
                surface={s}
                result={result.surfaces.find((r) => r.key === s.key)}
                onChange={(patch) => setSurface(s.key, patch)}
                onRemove={() => update((d) => ({ ...d, surfaces: d.surfaces.filter((x) => x.key !== s.key) }))}
                onPlace={(i) => update((d) => {
                  const o = d.unplaced[i];
                  return {
                    ...d,
                    unplaced: d.unplaced.filter((_, j) => j !== i),
                    surfaces: d.surfaces.map((x) => (x.key === s.key ? {
                      ...x,
                      openings: [...x.openings, { x: Math.max(0, Math.round((x.width - o.w) / 2)), y: 0, w: o.w, h: o.h }],
                    } : x)),
                  };
                })}
              />
            ))}
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1"
                onClick={() => update((d) => ({ ...d, surfaces: [...d.surfaces, wall(t('tileLayout.wallName', { n: d.surfaces.length + 1 }))] }))}>
                {t('tileLayout.addWall')}
              </Button>
              <Button variant="secondary" className="flex-1"
                onClick={() => update((d) => ({ ...d, surfaces: [...d.surfaces, floor(t('tileLayout.floorName'))] }))}>
                {t('tileLayout.addFloor')}
              </Button>
            </div>
            {storedView && (
              <Button variant="ghost" fullWidth onClick={() => setConfirmForget(true)} disabled={remove.isPending}>
                {t('tileLayout.forget')}
              </Button>
            )}
          </div>
        )}
      </div>

      {draft && result && draft.surfaces.length > 0 && (
        <Summary
          lineM2={item.quantity}
          result={result}
          saving={save.isPending}
          onSave={() => void onSave()}
        />
      )}

      {/* Closing the sheet is not an answer: nothing is marked, and the next save asks again. */}
      <Modal open={offer} onClose={() => { setOffer(false); void navigate(back); }} title={t('tileLayout.offerTitle')}>
        <p className="text-sm text-muted">{t('tileLayout.offerText')}</p>
        <label htmlFor="tl-room" className="mb-1 mt-3 block text-xs font-medium text-muted">{t('tileLayout.offerRoom')}</label>
        <Input id="tl-room" value={roomName} onChange={(e) => setRoomName(e.target.value)} />
        <p className="mt-2 text-xs text-muted">{t('tileLayout.offerNote')}</p>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" className="flex-1" disabled={keeping} onClick={() => void declineMeasurements()}>
            {t('tileLayout.offerNo')}
          </Button>
          <Button className="flex-1" loading={keeping} disabled={keeping} onClick={() => void keepMeasurements()}>
            {t('tileLayout.offerYes')}
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmForget}
        title={t('tileLayout.forgetTitle')}
        message={t('tileLayout.forgetText')}
        confirmLabel={t('tileLayout.forget')}
        onConfirm={() => void onForget()}
        onClose={() => setConfirmForget(false)}
      />
    </div>
  );
}

function FormatPicker({
  format, orientation, joint, onFormat, onOrientation, onJoint,
}: {
  format: { short: number; long: number } | null;
  orientation: 'LANDSCAPE' | 'PORTRAIT';
  joint: number;
  onFormat: (f: { short: number; long: number }) => void;
  onOrientation: (o: 'LANDSCAPE' | 'PORTRAIT') => void;
  onJoint: (j: number) => void;
}) {
  const { t } = useTranslation();
  const isStandard = format != null && STANDARD_FORMATS.some(([a, b]) => a === format.short && b === format.long);
  const [custom, setCustom] = useState(format != null && !isStandard);
  const [cw, setCw] = useState(format && !isStandard ? String(format.short) : '');
  const [ch, setCh] = useState(format && !isStandard ? String(format.long) : '');
  const applyCustom = (w: string, h: string) => {
    const a = Math.round(parseDecimal(w));
    const b = Math.round(parseDecimal(h));
    if (a >= 20 && b >= 20 && a <= 3600 && b <= 3600) onFormat({ short: Math.min(a, b), long: Math.max(a, b) });
  };
  const value = custom ? 'custom' : format ? `${format.short}x${format.long}` : '';

  return (
    <div className="mb-4 rounded-card border border-border bg-surface p-3">
      <p className="text-sm font-semibold text-primary">{t('tileLayout.formatTitle')}</p>
      {!format && <p className="mt-1 text-xs text-muted">{t('tileLayout.formatAsk')}</p>}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <label htmlFor="tl-format" className="mb-1 block text-xs font-medium text-muted">{t('tileLayout.formatLabel')}</label>
          <Select id="tl-format" value={value} onChange={(e) => {
            if (e.target.value === 'custom') {
              setCustom(true);
              return;
            }
            setCustom(false);
            const [a, b] = e.target.value.split('x').map(Number);
            onFormat({ short: a, long: b });
          }}>
            <option value="" disabled>{t('tileLayout.formatPlaceholder')}</option>
            {STANDARD_FORMATS.map(([a, b]) => (
              <option key={`${a}x${b}`} value={`${a}x${b}`}>{a}×{b} {t('tileLayout.mm')}</option>
            ))}
            <option value="custom">{t('tileLayout.formatCustom')}</option>
          </Select>
        </div>
        {custom && (
          <>
            <Field id="tl-cw" label={t('tileLayout.tileSide1')} value={cw} onChange={(v) => { setCw(v); applyCustom(v, ch); }} />
            <Field id="tl-ch" label={t('tileLayout.tileSide2')} value={ch} onChange={(v) => { setCh(v); applyCustom(cw, v); }} />
          </>
        )}
        {format && format.short !== format.long && (
          <div className="col-span-2 flex gap-2" role="group" aria-label={t('tileLayout.orientation')}>
            {(['LANDSCAPE', 'PORTRAIT'] as const).map((o) => (
              <button key={o} type="button" onClick={() => onOrientation(o)} aria-pressed={orientation === o}
                className={orientation === o
                  ? 'min-h-11 flex-1 rounded-xl bg-brand-600 text-sm font-semibold text-white'
                  : 'min-h-11 flex-1 rounded-xl bg-surface-sunken text-sm font-medium text-primary'}>
                {t(`tileLayout.orientation_${o}`)}
              </button>
            ))}
          </div>
        )}
        {format && (
          <Field id="tl-joint" label={t('tileLayout.joint')} value={String(joint)} onChange={(v) => {
            const j = parseDecimal(v);
            if (Number.isFinite(j) && j >= 0 && j <= 20) onJoint(j);
          }} />
        )}
      </div>
    </div>
  );
}

function ShapeChooser({ lineM2, floorLine, fromObject, onRoom, onSurface, onSurfaces, onByArea }: {
  lineM2: number;
  /** The line names a floor («…на підлогу») — the floor is offered first, the walls only on request. */
  floorLine: boolean;
  /** The object's rectangular measured surfaces, the line's own kind first. */
  fromObject: SurfaceDraft[];
  onRoom: (s: SurfaceDraft[]) => void;
  onSurface: (s: SurfaceDraft) => void;
  onSurfaces: () => void;
  onByArea: () => void;
}) {
  const { t } = useTranslation();
  const [room, setRoom] = useState(false);
  const [l, setL] = useState('');
  const [w, setW] = useState('');
  const [h, setH] = useState('');
  const ok = [l, w, h].every((v) => sizeToMm(v) > 0);
  const option = 'w-full rounded-card border border-border bg-surface p-3 text-left active:bg-surface-sunken';

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-primary">{t('tileLayout.shapeTitle')}</p>
      <p className="text-xs text-muted">{t('tileLayout.shapeHint', { qty: formatNumber(lineM2, 3) })}</p>
      {fromObject.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-primary">{t('tileLayout.fromObject')}</p>
          {fromObject.slice(0, 6).map((s) => (
            <button key={s.key} type="button" className={option} onClick={() => onSurface(s)}>
              <span className="block text-sm font-semibold text-primary">{s.name}</span>
              <span className="block text-xs tabular-nums text-muted">{mmToMetres(s.width)} × {mmToMetres(s.height)} {t('tileLayout.metres')}</span>
            </button>
          ))}
        </div>
      )}
      {floorLine && (
        <button type="button" className={option} onClick={onSurfaces}>
          <span className="block text-sm font-semibold text-primary">{t('tileLayout.shapeFloor')}</span>
          <span className="block text-xs text-muted">{t('tileLayout.shapeFloorHint')}</span>
        </button>
      )}
      <button type="button" className={option} onClick={() => setRoom(true)} aria-expanded={room}>
        <span className="block text-sm font-semibold text-primary">{t('tileLayout.shapeRoom')}</span>
        <span className="block text-xs text-muted">{t('tileLayout.shapeRoomHint')}</span>
      </button>
      {room && (
        <div className="grid grid-cols-3 gap-2 rounded-card bg-surface-sunken p-3">
          <Field id="tl-rl" label={t('tileLayout.roomLength')} value={l} onChange={setL} echo />
          <Field id="tl-rw" label={t('tileLayout.roomWidth')} value={w} onChange={setW} echo />
          <Field id="tl-rh" label={t('tileLayout.roomHeight')} value={h} onChange={setH} echo />
          <Button className="col-span-3" disabled={!ok} onClick={() => onRoom(roomSurfaces(
            sizeToMm(l), sizeToMm(w), sizeToMm(h), lineM2,
            { wall: (letter) => t('tileLayout.wallLetter', { letter }), floor: t('tileLayout.floorName') },
            floorLine || undefined,
          ))}>
            {t('tileLayout.roomBuild')}
          </Button>
        </div>
      )}
      {!floorLine && (
      <button type="button" className={option} onClick={onSurfaces}>
        <span className="block text-sm font-semibold text-primary">{t('tileLayout.shapeSurfaces')}</span>
        <span className="block text-xs text-muted">{t('tileLayout.shapeSurfacesHint')}</span>
      </button>
      )}
      <button type="button" className={option} onClick={onByArea}>
        <span className="block text-sm font-semibold text-primary">{t('tileLayout.shapeByArea')}</span>
        <span className="block text-xs text-muted">{t('tileLayout.shapeByAreaHint')}</span>
      </button>
    </div>
  );
}

function SurfaceCard({ draft, surface: s, result, onChange, onRemove, onPlace }: {
  draft: LayoutDraft;
  surface: SurfaceDraft;
  result: SurfaceResult | undefined;
  onChange: (patch: Partial<SurfaceDraft>) => void;
  onRemove: () => void;
  onPlace: (unplacedIndex: number) => void;
}) {
  const { t } = useTranslation();
  const layout = result?.layout ?? null;
  const tile = laidTile(draft);
  const narrow = layout?.edges.filter((e) => e.narrow) ?? [];
  const id = s.key;
  const [moving, setMoving] = useState(false);
  /** Hand the grid to the master from where it stands now, so the first drag moves nothing. */
  const startMoving = () => {
    if (layout) onChange({ start: 'MANUAL', origin: layout.origin });
    setMoving(true);
  };
  const moveGrid = (origin: { x: number; y: number }) => onChange({ start: 'MANUAL', origin });
  const nudge = (dx: number, dy: number) => {
    const from = s.start === 'MANUAL' && s.origin ? s.origin : layout?.origin;
    if (from) moveGrid({ x: from.x + dx, y: from.y + dy });
  };

  return (
    <div className="rounded-card border border-border bg-surface p-3">
      <div className="flex items-center gap-2">
        <input id={`${id}-on`} type="checkbox" checked={s.enabled} onChange={(e) => onChange({ enabled: e.target.checked })}
          className="h-5 w-5 flex-shrink-0 accent-brand-600" aria-label={t('tileLayout.surfaceOn', { name: s.name })} />
        <Input aria-label={t('tileLayout.surfaceName')} value={s.name} onChange={(e) => onChange({ name: e.target.value })}
          className="min-w-0 flex-1 font-semibold" />
        {layout && (
          <span className="flex-shrink-0 text-sm font-bold tabular-nums text-primary">
            {layout.minTiles === layout.maxTiles ? layout.maxTiles : `${layout.minTiles}–${layout.maxTiles}`} {t('units.PIECE')}
          </span>
        )}
      </div>

      {s.enabled && (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <SizeField id={`${id}-w`} label={s.floor ? t('tileLayout.length') : t('tileLayout.width')} mm={s.width}
              onMm={(width) => onChange({ width })} />
            <SizeField id={`${id}-h`} label={s.floor ? t('tileLayout.floorWidth') : t('tileLayout.height')} mm={s.height}
              onMm={(height) => onChange({ height })} />
            <div>
              <label htmlFor={`${id}-p`} className="mb-1 block text-xs font-medium text-muted">{t('tileLayout.pattern')}</label>
              <Select id={`${id}-p`} value={s.pattern} onChange={(e) => onChange({ pattern: e.target.value as LayoutPattern })}>
                {PATTERNS.map((p) => <option key={p} value={p}>{t(`tileLayout.pattern_${p}`)}</option>)}
              </Select>
            </div>
            <div>
              <label htmlFor={`${id}-s`} className="mb-1 block text-xs font-medium text-muted">{t('tileLayout.start')}</label>
              <Select id={`${id}-s`} value={s.start} onChange={(e) => onChange({ start: e.target.value as LayoutStart })}>
                {STARTS.map((p) => <option key={p} value={p}>{t(`tileLayout.start_${p}`)}</option>)}
              </Select>
            </div>
          </div>

          {result?.error && (result.error !== 'SURFACE' || (s.width > 0 && s.height > 0)) && (
            <p className="mt-2 text-xs text-danger">{t(`tileLayout.error_${result.error}`)}</p>
          )}

          {layout && (
            <div className="mt-2 rounded-xl bg-surface-sunken p-2">
              <TileLayoutDrawing width={s.width} height={s.height} layout={layout} openings={s.openings} tile={tile}
                label={t('tileLayout.drawingLabel', { name: s.name })}
                {...(moving ? {
                  onMoveGrid: moveGrid,
                  onMoveOpening: (i: number, at: { x: number; y: number }) => onChange({
                    openings: s.openings.map((o, j) => (j === i ? clampOpening(s, { ...o, ...at }) : o)),
                  }),
                } : {})} />
              {moving ? (
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-muted">{t('tileLayout.moveHint')}</p>
                  <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={t('tileLayout.nudge')}>
                    {([[-NUDGE_MM, 0, '◀', 'nudgeLeft'], [NUDGE_MM, 0, '▶', 'nudgeRight'], [0, NUDGE_MM, '▲', 'nudgeUp'],
                      [0, -NUDGE_MM, '▼', 'nudgeDown']] as const).map(([dx, dy, glyph, key]) => (
                      <button key={key} type="button" onClick={() => nudge(dx, dy)} aria-label={t(`tileLayout.${key}`)}
                        className="min-h-11 rounded-xl bg-surface text-base font-semibold text-primary active:bg-border">
                        {glyph}
                      </button>
                    ))}
                    <button type="button" onClick={() => setMoving(false)}
                      className="col-span-4 min-h-11 rounded-xl bg-brand-600 text-sm font-semibold text-white">
                      {t('tileLayout.moveDone')}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={startMoving} className="mt-1 min-h-11 text-xs font-semibold text-brand-700">
                  ✋ {t('tileLayout.moveStart')}
                </button>
              )}
              <p className="mt-1 text-xs tabular-nums text-muted">
                {t('tileLayout.piecesLine', { full: layout.full, cut: layout.cut + layout.shaped })}
              </p>
            </div>
          )}

          {narrow.length > 0 && (
            <div className="mt-2 rounded-xl bg-danger-soft p-2 text-xs text-danger">
              <p>{narrow.map((e) => t(`tileLayout.narrow_${e.side}`, { mm: Math.round(e.min) })).join(' · ')}</p>
              {s.start !== 'AUTO' && !layout?.hints.includes('NARROW_UNAVOIDABLE') && (
                <button type="button" className="mt-1 min-h-11 font-semibold underline"
                  onClick={() => onChange({ start: s.pattern === 'STRAIGHT' ? 'SYMMETRIC' : 'AUTO' })}>
                  {s.pattern === 'STRAIGHT' ? t('tileLayout.fixSymmetric') : t('tileLayout.fixAuto')}
                </button>
              )}
            </div>
          )}

          {layout?.hints.map((h) => (
            <p key={h} className="mt-2 rounded-xl bg-amber-soft px-2 py-1.5 text-xs text-amber-strong">
              {h === 'MOSTLY_CUT' && result?.cornerCutsLess ? t('tileLayout.hint_MOSTLY_CUT_START') : t(`tileLayout.hint_${h}`)}
            </p>
          ))}

          <Openings surface={s} onChange={onChange} />

          {draft.unplaced.length > 0 && !s.floor && (
            <div className="mt-2 flex flex-wrap gap-2">
              {draft.unplaced.map((o, i) => (
                <button key={i} type="button" onClick={() => onPlace(i)}
                  className="min-h-11 rounded-xl bg-amber-soft px-3 text-xs font-semibold text-amber-strong">
                  {t('tileLayout.placeHere', { w: mmToMetres(o.w), h: mmToMetres(o.h) })}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <button type="button" onClick={onRemove} className="mt-1 min-h-11 text-xs font-medium text-muted">
        {t('tileLayout.removeSurface')}
      </button>
    </div>
  );
}

function Openings({ surface: s, onChange }: { surface: SurfaceDraft; onChange: (patch: Partial<SurfaceDraft>) => void }) {
  const { t } = useTranslation();
  const set = (i: number, k: 'x' | 'y' | 'w' | 'h', mm: number) => onChange({
    openings: s.openings.map((o, j) => (j === i ? { ...o, [k]: mm } : o)),
  });
  return (
    <div className="mt-2">
      {s.openings.map((o, i) => (
        <div key={i} className="mb-2 grid grid-cols-2 gap-1.5 rounded-xl bg-surface-sunken p-2">
          <SizeField id={`${s.key}-o${i}-w`} label={t('tileLayout.openingW')} mm={o.w} onMm={(v) => set(i, 'w', v)} />
          <SizeField id={`${s.key}-o${i}-h`} label={t('tileLayout.openingH')} mm={o.h} onMm={(v) => set(i, 'h', v)} />
          <SizeField id={`${s.key}-o${i}-x`} label={t('tileLayout.openingX')} mm={o.x} onMm={(v) => set(i, 'x', v)} />
          <SizeField id={`${s.key}-o${i}-y`} label={t('tileLayout.openingY')} mm={o.y} onMm={(v) => set(i, 'y', v)} />
          <button type="button" className="col-span-2 min-h-11 text-left text-xs font-medium text-muted"
            onClick={() => onChange({ openings: s.openings.filter((_, j) => j !== i) })}>
            {t('tileLayout.removeOpening')}
          </button>
        </div>
      ))}
      <button type="button" className="min-h-11 text-xs font-semibold text-brand-700"
        onClick={() => onChange({ openings: [...s.openings, { x: 0, y: 0, w: s.floor ? 0 : 700, h: s.floor ? 0 : 2000 }] })}>
        {s.floor ? t('tileLayout.addCutout') : t('tileLayout.addOpening')}
      </button>
    </div>
  );
}

function Summary({ lineM2, result, saving, onSave }: {
  lineM2: number;
  result: ReturnType<typeof evaluate>;
  saving: boolean;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const buyMin = result.minTiles + result.spare;
  const buyMax = result.maxTiles + result.spare;
  // Against the LOWER bound: «at least N short» is what by-area certainly misses, not the worst case.
  const short = result.byArea > 0 && result.byArea < buyMin ? buyMin - result.byArea : 0;
  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-border bg-surface px-4 pt-3 sm:px-6"
      style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
      <div className="mx-auto max-w-xl space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-muted">{t('tileLayout.laid', { laid: formatNumber(Math.round(result.laidArea * 100) / 100, 2), qty: formatNumber(lineM2, 2) })}</span>
          <span className="text-base font-extrabold tabular-nums text-primary">
            {buyMin === buyMax ? buyMax : `${buyMin}–${buyMax}`} {t('units.PIECE')}
          </span>
        </div>
        <p className="text-[11px] text-muted">{t('tileLayout.rangeHint', { spare: result.spare })}</p>
        {result.rest > 0 && <p className="text-[11px] text-muted">{t('tileLayout.restByArea', { rest: formatNumber(Math.round(result.rest * 100) / 100, 2) })}</p>}
        {short > 0 && <p className="text-[11px] text-amber-strong">{t('tileLayout.byAreaShort', { byArea: result.byArea, short })}</p>}
        {result.overLine && <p className="text-[11px] text-amber-strong">{t('tileLayout.overLine')}</p>}
        <Button fullWidth loading={saving} disabled={saving || !canSave(result)} onClick={onSave}>
          {t('tileLayout.done', { n: buyMax })}
        </Button>
      </div>
    </div>
  );
}

function Field({ id, label, value, onChange, echo = false }: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  /** A size in metres: say how a number too big for metres was read («= 3,6 м»). */
  echo?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block truncate text-[11px] font-medium text-muted">{label}</label>
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0" />
      {echo && readAsMm(value) && (
        <p className="mt-0.5 text-[11px] tabular-nums text-muted">{t('tileLayout.readAsMm', { m: mmToMetres(sizeToMm(value)) })}</p>
      )}
    </div>
  );
}

/**
 * A size in METRES over a value kept in mm. What he types stays as typed while it means the stored
 * value («3,» is 3 m on the way to «3,6»); a value changed elsewhere — an opening dragged — shows anew.
 */
function SizeField({ id, label, mm, onMm }: { id: string; label: string; mm: number; onMm: (mm: number) => void }) {
  const [text, setText] = useState(() => mmToMetres(mm));
  const shown = sizeToMm(text) === mm ? text : mmToMetres(mm);
  return (
    <Field id={id} label={label} value={shown} echo onChange={(v) => {
      setText(v);
      onMm(sizeToMm(v));
    }} />
  );
}
