import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/Input.tsx';
import { Button } from '@/components/Button.tsx';
import { cn } from '@/lib/cn.ts';
import { ShapeInput } from '@/components/ShapeInput.tsx';
import {
  LENGTH_FACTOR,
  LENGTH_UNITS,
  newDraft,
  planeFromLegacy,
  planesAreaM2,
  toDraft,
  toPlane,
  type LengthUnit,
  type PlaneDraft,
} from '@/lib/shapes.ts';
import { CHASE_KINDS, WallDiagram } from '@/components/WallDiagram.tsx';
import { PlanEditor } from '@/components/PlanEditor.tsx';
import { busLengthMm, defaultBus, defaultPoints, type PlanPt } from '@/lib/planBus.ts';
import type {
  LinearPayload,
  MeasurementItem,
  MeasurementItemRequest,
  MeasurementType,
  PartitionPayload,
  PointsPayload,
  ShtrobaPayload,
  SurfacePayload,
} from '@/api/types.ts';

/**
 * Editor for one measured element (3 types). Computes a live result (mirrors the backend
 * formulas; the server recomputes authoritatively on save) and builds the typed payload.
 * SURFACE is Σ planes − Σ openings, where a plane is any shape from the shared `shapes`
 * module — the same module the single-line calculator uses, so both agree.
 */

type Opening = { w: string; h: string; n: string };
const num = (s: string): number => {
  const n = Number(String(s).replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const posInt = (s: string): number => Math.max(1, Math.round(num(s) || 1));

const TYPES: { type: MeasurementType; labelKey: string }[] = [
  { type: 'SURFACE', labelKey: 'measure.typeSurface' },
  { type: 'PARTITION', labelKey: 'measure.typePartition' },
  { type: 'LINEAR', labelKey: 'measure.typeLinear' },
  { type: 'ELECTRICAL_POINTS', labelKey: 'measure.typePoints' },
  { type: 'SHTROBA', labelKey: 'measure.typeShtroba' },
];

type ChaseRow = { kind: string; h: string; qty: string; chase: boolean };
type PointRow = { type: string; count: string };

export function MeasurementItemForm({
  initial,
  onSave,
  onCancel,
  saving,
  hostUnit,
  onLiveChange,
  allowedTypes,
}: {
  initial?: MeasurementItem;
  onSave: (req: MeasurementItemRequest) => void;
  onCancel: () => void;
  saving?: boolean;
  /** Restrict the type picker (and the default type) — e.g. area-only in «Заміри»,
   *  or SHTROBA-only when opened as the electrical chase calculator. */
  allowedTypes?: MeasurementType[];
  /** Review mode (sketch import): the SURFACE unit is driven by the parent's sheet-level
   *  switch instead of this form's own, so one dial reinterprets every element at once. */
  hostUnit?: LengthUnit;
  /** Review mode: report the current request live (null = not yet valid) and hide the
   *  Save/Cancel footer — the parent owns the single commit. */
  onLiveChange?: (req: MeasurementItemRequest | null) => void;
}) {
  const { t } = useTranslation();
  const reviewMode = onLiveChange != null;
  const typesShown = allowedTypes ? TYPES.filter((ty) => allowedTypes.includes(ty.type)) : TYPES;
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<MeasurementType>(initial?.type ?? typesShown[0]?.type ?? 'SURFACE');

  // SURFACE — planes (any shape) minus openings, all in one unit.
  const initSurface = initial?.type === 'SURFACE' ? (initial.payload as SurfacePayload) : undefined;
  // Metres by default — that's what every dimension in the app meant before units
  // existed, so an existing habit can't silently produce a wrong area.
  const [internalUnit, setInternalUnit] = useState<LengthUnit>(initSurface?.unit ?? 'M');
  const unit = hostUnit ?? internalUnit;
  const [planes, setPlanes] = useState<PlaneDraft[]>(
    initSurface?.segments.map((s) =>
      // A shape-less segment is a pre-shapes rectangle stored in metres.
      s.shape
        ? toDraft({ shape: s.shape, mode: s.mode ?? 'd', values: s.values ?? {} })
        : toDraft(planeFromLegacy(s.l ?? 0, s.w ?? 0)),
    ) ?? [newDraft('rect')],
  );
  const [openings, setOpenings] = useState<Opening[]>(
    initSurface?.openings.map((o) => ({ w: String(o.w), h: String(o.h), n: String(o.n) })) ?? [],
  );

  // PARTITION
  const initPart = initial?.type === 'PARTITION' ? (initial.payload as PartitionPayload) : undefined;
  const [pDims, setPDims] = useState({
    height: initPart ? String(initPart.height) : '',
    width: initPart ? String(initPart.width) : '',
    depth: initPart ? String(initPart.depth) : '',
  });
  const [faces, setFaces] = useState(
    initPart?.faces ?? { left: true, right: true, end: true, top: false },
  );

  // LINEAR
  const initLin = initial?.type === 'LINEAR' ? (initial.payload as LinearPayload) : undefined;
  const [lDims, setLDims] = useState({
    height: initLin ? String(initLin.height) : '',
    width: initLin ? String(initLin.width) : '',
    qty: initLin ? String(initLin.qty) : '1',
  });
  const [sides, setSides] = useState(
    initLin?.sides ?? { left: true, right: true, top: true, bottom: false },
  );

  // ELECTRICAL_POINTS — counts per legend type (шт).
  const initPoints = initial?.type === 'ELECTRICAL_POINTS' ? (initial.payload as PointsPayload) : undefined;
  const [pointRows, setPointRows] = useState<PointRow[]>(
    initPoints?.points.map((p) => ({ type: p.type, count: String(p.count) })) ?? [{ type: '', count: '' }],
  );

  // SHTROBA/CABLE — ONE shared input drives BOTH results (кабель = material, штроба = work).
  // The bus length is EXPLICIT (set by the master, never guessed off the drawing). Millimetres.
  const isCalc = type === 'SHTROBA' || type === 'CABLE';
  const initCalc =
    initial?.type === 'SHTROBA' || initial?.type === 'CABLE'
      ? (initial.payload as ShtrobaPayload)
      : undefined;
  const [busLevel, setBusLevel] = useState(initCalc ? String(initCalc.busLevel) : '2600');
  const [busFromTop, setBusFromTop] = useState(initCalc ? initCalc.busFromTop : true);
  const [busLength, setBusLength] = useState(initCalc ? String(initCalc.busLength) : '');
  const [busChase, setBusChase] = useState(initCalc ? initCalc.busChase : true);
  const [reservePct, setReservePct] = useState(initCalc ? String(initCalc.reservePct) : '10');
  const [chase, setChase] = useState<ChaseRow[]>(
    initCalc?.points.map((p) => ({
      kind: p.kind, h: String(p.h), qty: String(p.qty), chase: p.chase,
    })) ?? [{ kind: 'socket', h: '300', qty: '1', chase: true }],
  );

  // Phase C — the bus length can be TYPED (manual) or MEASURED off a to-scale room plan the
  // master draws. In plan mode the drawn polyline's length is the bus length (traceable: it's
  // as long as the line you drew), so it overrides the manual field.
  const initTop = initCalc ? initCalc.busFromTop : true;
  const [busMode, setBusMode] = useState<'manual' | 'plan'>('manual');
  const [roomW, setRoomW] = useState('4000');
  const [roomL, setRoomL] = useState('3000');
  const [busPath, setBusPath] = useState<PlanPt[]>(() => defaultBus(initTop));
  const [planPoints, setPlanPoints] = useState<PlanPt[]>(() => defaultPoints(chase.length, initTop));

  // Keep one plan dot per drop row (positions are a drawing aid, not persisted).
  useEffect(() => {
    setPlanPoints((prev) => {
      if (prev.length === chase.length) return prev;
      if (prev.length < chase.length) {
        return [...prev, ...defaultPoints(chase.length - prev.length, busFromTop)];
      }
      return prev.slice(0, chase.length);
    });
  }, [chase.length, busFromTop]);

  const derivedBusMm = useMemo(
    () => busLengthMm(busPath, num(roomW), num(roomL)),
    [busPath, roomW, roomL],
  );
  const effectiveBusMm = busMode === 'plan' ? derivedBusMm : num(busLength);

  // Mirrors the server formulas exactly (MeasurementCalc.cable / .chase). A drop is
  // |bus level − its height| × qty; the bus is the explicit busLength.
  //   CABLE  = busLength + Σ ALL drops, then × (1 + reserve%)  — the wire reaches every point.
  //   SHTROBA (chase) = (busLength if busChase) + Σ drops whose point is flagged — only what
  //   is actually cut. No reserve.
  const chasePoints = useMemo(
    () => chase.map((c) => ({ kind: c.kind, h: num(c.h), qty: posInt(c.qty), chase: c.chase })),
    [chase],
  );
  const calc = useMemo(() => {
    const level = busFromTop ? num(busLevel) : 0;
    const drop = (p: { h: number; qty: number }) => Math.abs(level - p.h) * p.qty;
    const busLen = effectiveBusMm;
    const dropsAll = chasePoints.reduce((s, p) => s + drop(p), 0);
    const dropsChased = chasePoints.filter((p) => p.chase).reduce((s, p) => s + drop(p), 0);
    const cableMm = (busLen + dropsAll) * (1 + num(reservePct) / 100);
    const chaseMm = (busChase ? busLen : 0) + dropsChased;
    return {
      busLen: round3(busLen / 1000),
      dropsAll: round3(dropsAll / 1000),
      cable: round3(Math.max(0, cableMm) / 1000),
      chase: round3(Math.max(0, chaseMm) / 1000),
    };
  }, [chasePoints, busLevel, busFromTop, effectiveBusMm, busChase, reservePct]);

  const pointsTotal = useMemo(
    () => pointRows.reduce((s, r) => s + Math.max(0, Math.round(num(r.count))), 0),
    [pointRows],
  );

  // Surface sub-totals, in m² — shown so the master can check the arithmetic.
  const planesM2 = useMemo(() => planesAreaM2(planes.map(toPlane), unit), [planes, unit]);
  const openingsM2 = useMemo(() => {
    const f = LENGTH_FACTOR[unit];
    return round3(
      openings.reduce((s, o) => s + num(o.w) * num(o.h) * posInt(o.n) * f * f, 0),
    );
  }, [openings, unit]);

  const result = useMemo(() => {
    if (type === 'ELECTRICAL_POINTS') return pointsTotal;
    if (type === 'CABLE') return calc.cable;
    if (type === 'SHTROBA') return calc.chase;
    if (type === 'SURFACE') return round3(Math.max(0, planesM2 - openingsM2));
    if (type === 'PARTITION') {
      const h = num(pDims.height), w = num(pDims.width), d = num(pDims.depth);
      let r = 0;
      if (faces.left) r += h * w;
      if (faces.right) r += h * w;
      if (faces.end) r += h * d;
      if (faces.top) r += w * d;
      return round3(Math.max(0, r));
    }
    const h = num(lDims.height), w = num(lDims.width);
    let per = 0;
    if (sides.left) per += h;
    if (sides.right) per += h;
    if (sides.top) per += w;
    if (sides.bottom) per += w;
    return round3(Math.max(0, per * posInt(lDims.qty)));
  }, [type, planesM2, openingsM2, pDims, faces, lDims, sides, pointsTotal, calc]);

  const unitKey =
    type === 'ELECTRICAL_POINTS' ? 'units.PIECE'
      : type === 'CABLE' ? 'units.M'
        : type === 'LINEAR' || type === 'SHTROBA' ? 'units.LINEAR_METER'
          : 'units.M2';

  const buildPayload = (): MeasurementItemRequest['payload'] => {
    if (type === 'ELECTRICAL_POINTS') {
      return {
        points: pointRows
          .filter((r) => r.type.trim())
          .map((r) => ({ type: r.type.trim(), count: Math.max(0, Math.round(num(r.count))), heights: [] })),
      };
    }
    if (isCalc) {
      return {
        busLevel: num(busLevel),
        busFromTop,
        busLength: effectiveBusMm,
        busChase,
        reservePct: num(reservePct),
        points: chasePoints,
      };
    }
    if (type === 'SURFACE') {
      return {
        unit,
        segments: planes.map(toPlane),
        openings: openings.map((o) => ({ w: num(o.w), h: num(o.h), n: posInt(o.n) })),
      };
    }
    if (type === 'PARTITION') {
      return { height: num(pDims.height), width: num(pDims.width), depth: num(pDims.depth), faces };
    }
    return { height: num(lDims.height), width: num(lDims.width), sides, qty: posInt(lDims.qty) };
  };

  const canSave = name.trim().length > 0 && result > 0;

  // Review mode: stream the current request up (null until valid) so the parent's single
  // commit can aggregate every element without its own copy of the payload logic.
  useEffect(() => {
    if (!onLiveChange) return;
    onLiveChange(canSave ? { name: name.trim(), type, payload: buildPayload() } : null);
    // buildPayload is derived from the same state listed here; excluded to avoid a re-run loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onLiveChange, canSave, name, type, planes, openings, pDims, faces, lDims, sides, unit]);

  const Toggle = ({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border px-2.5 py-2 text-xs font-semibold',
        on ? 'border-brand bg-brand-soft text-brand' : 'border-border text-muted',
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <Input
        placeholder={t('measure.elementNamePlaceholder')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={255}
      />

      {/* Type picker (only for a new element; editing keeps the type fixed).
          Hidden when the caller pinned a single type (e.g. the chase calculator). */}
      {!initial && typesShown.length > 1 && (
        <div className="grid grid-cols-3 gap-2">
          {typesShown.map((ty) => (
            <button
              key={ty.type}
              type="button"
              onClick={() => setType(ty.type)}
              className={cn(
                'rounded-lg border px-2 py-2 text-xs font-semibold transition-colors',
                type === ty.type ? 'border-brand bg-brand-soft text-brand' : 'border-border text-primary',
              )}
            >
              {t(ty.labelKey)}
            </button>
          ))}
        </div>
      )}

      {/* SURFACE — Σ planes (any shape) − Σ openings, all measured in one unit. */}
      {type === 'SURFACE' && (
        <div className="rounded-xl border border-border bg-surface-sunken p-3">
          <p className="mb-2 text-xs text-muted">{t('shape.hintTape')}</p>

          {/* One unit for the whole element — planes and openings alike. In review mode the
              parent's sheet-level switch drives it (hostUnit), so this one is hidden. */}
          {!hostUnit && (
          <div className="mb-3 flex justify-center gap-1.5">
            {LENGTH_UNITS.map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setInternalUnit(u)}
                className={cn(
                  'min-h-[44px] rounded-lg border px-3.5 text-xs font-semibold transition-colors',
                  unit === u ? 'border-brand bg-brand-soft text-brand' : 'border-border text-muted',
                )}
              >
                {t(`lengthUnit.${u}`)}
              </button>
            ))}
          </div>
          )}

          <div className="space-y-3">
            {planes.map((p, i) => (
              <div key={i} className="rounded-xl border border-border bg-surface p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted">
                    {t('shape.plane', { n: i + 1 })}
                  </span>
                  {planes.length > 1 && (
                    <button
                      type="button"
                      aria-label={t('common.delete')}
                      className="px-1 text-muted"
                      onClick={() => setPlanes((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      ✕
                    </button>
                  )}
                </div>
                <ShapeInput
                  draft={p}
                  unit={unit}
                  onChange={(d) => setPlanes((prev) => prev.map((x, idx) => (idx === i ? d : x)))}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mt-2 text-xs font-semibold text-brand"
            onClick={() => setPlanes((p) => [...p, newDraft('rect')])}
          >
            {t('shape.addPlane')}
          </button>

          <div className="mt-3 border-t border-border pt-3">
            <div className="mb-1.5 text-xs font-semibold text-muted">
              {t('estimate.measureOpenings')} ({t(`lengthUnit.${unit}`)})
            </div>
            <div className="space-y-2">
              {openings.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input inputMode="decimal" placeholder={t('estimate.measureWidth')} value={o.w}
                    onChange={(e) => setOpenings((p) => p.map((x, idx) => (idx === i ? { ...x, w: e.target.value } : x)))} />
                  <span className="text-muted">×</span>
                  <Input inputMode="decimal" placeholder={t('estimate.measureHeight')} value={o.h}
                    onChange={(e) => setOpenings((p) => p.map((x, idx) => (idx === i ? { ...x, h: e.target.value } : x)))} />
                  <span className="text-muted">×</span>
                  <Input inputMode="numeric" placeholder={t('estimate.measureCount')} value={o.n} className="w-16"
                    onChange={(e) => setOpenings((p) => p.map((x, idx) => (idx === i ? { ...x, n: e.target.value } : x)))} />
                  <button type="button" aria-label={t('common.delete')} className="px-1 text-muted"
                    onClick={() => setOpenings((p) => p.filter((_, idx) => idx !== i))}>✕</button>
                </div>
              ))}
            </div>
            <button type="button" className="mt-2 text-xs font-semibold text-brand"
              onClick={() => setOpenings((p) => [...p, { w: '', h: '', n: '1' }])}>
              {t('estimate.measureAddOpening')}
            </button>
          </div>

          {/* Intermediate sums — the master should see where the result comes from. */}
          <div className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted">
            <div className="flex justify-between">
              <span>{t('shape.planesTotal')}</span>
              <span className="font-semibold text-primary">{planesM2} {t('units.M2')}</span>
            </div>
            {openingsM2 > 0 && (
              <div className="flex justify-between">
                <span>{t('shape.openingsTotal')}</span>
                <span className="font-semibold text-primary">−{openingsM2} {t('units.M2')}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ELECTRICAL_POINTS — counts per legend type (шт). Filled by hand or from a plan. */}
      {type === 'ELECTRICAL_POINTS' && (
        <div className="rounded-xl border border-border bg-surface-sunken p-3">
          <p className="mb-2 text-xs text-muted">{t('measure.pointsHint')}</p>
          <div className="space-y-2">
            {pointRows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input placeholder={t('measure.pointTypePlaceholder')} value={r.type}
                  onChange={(e) => setPointRows((p) => p.map((x, idx) => (idx === i ? { ...x, type: e.target.value } : x)))} />
                <Input inputMode="numeric" className="w-20" placeholder={t('measure.count')} value={r.count}
                  onChange={(e) => setPointRows((p) => p.map((x, idx) => (idx === i ? { ...x, count: e.target.value } : x)))} />
                {pointRows.length > 1 && (
                  <button type="button" aria-label={t('common.delete')} className="px-1 text-muted"
                    onClick={() => setPointRows((p) => p.filter((_, idx) => idx !== i))}>✕</button>
                )}
              </div>
            ))}
          </div>
          <button type="button" className="mt-2 text-xs font-semibold text-brand"
            onClick={() => setPointRows((p) => [...p, { type: '', count: '' }])}>
            {t('measure.addPointType')}
          </button>
        </div>
      )}

      {/* SHTROBA/CABLE — the chase/cable calculator: one bus + drops, computed into BOTH a
          cable length (material, м) and a chase length (work, м.пог). The wall is drawn so the
          metres are checkable — never a black-box total. */}
      {isCalc && (
        <div className="rounded-xl border border-border bg-surface-sunken p-3">
          <p className="mb-2 text-xs text-muted">{t('shtroba.hint')}</p>

          {/* Магістраль: its length is TYPED, or MEASURED off a room plan the master draws. */}
          <div className="mb-3 rounded-lg border border-border bg-surface p-2.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-secondary">{t('shtroba.busSection')}</span>
              <div className="flex gap-1">
                {(['manual', 'plan'] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setBusMode(m)}
                    className={cn('min-h-[32px] rounded-lg border px-2.5 text-[11px] font-semibold transition-colors',
                      busMode === m ? 'border-brand bg-brand-soft text-brand' : 'border-border text-muted')}>
                    {t(m === 'manual' ? 'shtroba.busManual' : 'shtroba.busPlan')}
                  </button>
                ))}
              </div>
            </div>

            {busMode === 'manual' ? (
              <label className="block">
                <span className="mb-1 block text-xs text-muted">{t('shtroba.busLength')}</span>
                <Input inputMode="numeric" value={busLength} placeholder="0"
                  onChange={(e) => setBusLength(e.target.value)} />
              </label>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-muted">{t('shtroba.roomW')}</span>
                    <Input inputMode="numeric" value={roomW} onChange={(e) => setRoomW(e.target.value)} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-muted">{t('shtroba.roomL')}</span>
                    <Input inputMode="numeric" value={roomL} onChange={(e) => setRoomL(e.target.value)} />
                  </label>
                </div>
                <p className="text-[11px] text-muted">{t('shtroba.planHint')}</p>
                <PlanEditor
                  widthMm={num(roomW)} lengthMm={num(roomL)}
                  bus={busPath} points={planPoints} pointKinds={chase.map((c) => c.kind)}
                  onBusChange={setBusPath} onPointsChange={setPlanPoints} />
                <div className="flex items-center justify-between gap-2">
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => setBusPath((p) => [...p, { x: 0.5, y: 0.5 }])}
                      className="min-h-[36px] rounded-lg border border-border px-2.5 text-[11px] font-semibold text-brand">
                      {t('shtroba.busAddVertex')}
                    </button>
                    <button type="button" disabled={busPath.length <= 2} onClick={() => setBusPath((p) => p.slice(0, -1))}
                      className="min-h-[36px] rounded-lg border border-border px-2.5 text-[11px] font-semibold text-muted disabled:opacity-40">
                      {t('shtroba.busDelVertex')}
                    </button>
                  </div>
                  <span className="text-xs font-semibold text-primary">
                    {t('shtroba.busLength')}: {calc.busLen} {t('units.M')}
                  </span>
                </div>
              </div>
            )}

            {/* Is the bus itself chased? (No when it runs along the ceiling.) */}
            <button type="button" onClick={() => setBusChase((v) => !v)}
              className={cn('mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border px-2 text-xs font-semibold transition-colors',
                busChase ? 'border-brand bg-brand-soft text-brand' : 'border-border text-muted')}>
              <span aria-hidden>{busChase ? '☑' : '☐'}</span>{t('shtroba.busChase')}
            </button>
          </div>

          {/* Bus height above the floor + cable reserve %. */}
          <div className="mb-2 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs text-muted">{t('shtroba.busLevel')}</span>
              <Input inputMode="numeric" value={busLevel} onChange={(e) => setBusLevel(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted">{t('shtroba.reserve')}</span>
              <Input inputMode="numeric" value={reservePct} onChange={(e) => setReservePct(e.target.value)} />
            </label>
          </div>

          {/* Per-room choice: ground floors are usually chased from the ceiling, upper from the floor. */}
          <div className="mb-3 flex gap-2">
            {[true, false].map((top) => (
              <button key={String(top)} type="button" onClick={() => setBusFromTop(top)}
                className={cn('min-h-[40px] flex-1 rounded-lg border px-3 text-xs font-semibold transition-colors',
                  busFromTop === top ? 'border-brand bg-brand-soft text-brand' : 'border-border text-muted')}>
                {t(top ? 'shtroba.fromTop' : 'shtroba.fromBottom')}
              </button>
            ))}
          </div>

          <WallDiagram points={chasePoints} busLevel={num(busLevel)} busFromTop={busFromTop} busChase={busChase} />

          <div className="mt-3 space-y-2">
            {chase.map((c, i) => {
              const level = busFromTop ? num(busLevel) : 0;
              const dropM = round3((Math.abs(level - num(c.h)) * posInt(c.qty)) / 1000);
              return (
                <div key={i} className="rounded-lg border border-border bg-surface p-2">
                  <div className="mb-2 flex items-center gap-2">
                    <select value={c.kind}
                      onChange={(e) => setChase((p) => p.map((x, idx) => (idx === i
                        ? { ...x, kind: e.target.value, h: String(CHASE_KINDS[e.target.value].defH) } : x)))}
                      className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs font-semibold text-primary">
                      {Object.entries(CHASE_KINDS).map(([k, v]) => (
                        <option key={k} value={k}>{t(v.labelKey)}</option>
                      ))}
                    </select>
                    <span className="ml-auto text-xs font-semibold text-muted">↓ {dropM} {t('units.M')}</span>
                    {chase.length > 1 && (
                      <button type="button" aria-label={t('common.delete')} className="px-1 text-muted"
                        onClick={() => setChase((p) => p.filter((_, idx) => idx !== i))}>✕</button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(['h', 'qty'] as const).map((f) => (
                      <label key={f} className="block">
                        <span className="mb-0.5 block text-[10px] text-muted">{t(`shtroba.field_${f}`)}</span>
                        <Input inputMode="numeric" value={c[f]}
                          onChange={(e) => setChase((p) => p.map((x, idx) => (idx === i ? { ...x, [f]: e.target.value } : x)))} />
                      </label>
                    ))}
                  </div>
                  {/* Per-drop: an un-plastered wall is wired (cable) but not chased. */}
                  <button type="button"
                    onClick={() => setChase((p) => p.map((x, idx) => (idx === i ? { ...x, chase: !x.chase } : x)))}
                    className={cn('mt-2 flex min-h-[40px] w-full items-center justify-center gap-2 rounded-lg border px-2 text-[11px] font-semibold transition-colors',
                      c.chase ? 'border-brand bg-brand-soft text-brand' : 'border-border text-muted')}>
                    <span aria-hidden>{c.chase ? '☑' : '☐'}</span>{t('shtroba.pointChase')}
                  </button>
                </div>
              );
            })}
          </div>
          <button type="button" className="mt-2 text-xs font-semibold text-brand"
            onClick={() => setChase((p) => [...p, { kind: 'socket', h: '300', qty: '1', chase: true }])}>
            {t('shtroba.addPoint')}
          </button>

          {/* The three величини: bus, all drops, and the two deliverables (cable + chase). */}
          <div className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted">
            <div className="flex justify-between">
              <span>{t('shtroba.busTotal')}</span>
              <span className="font-semibold text-primary">{calc.busLen} {t('units.M')}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('shtroba.dropsTotal')}</span>
              <span className="font-semibold text-primary">{calc.dropsAll} {t('units.M')}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-border pt-1.5">
              <span className="text-secondary">⚡ {t('shtroba.cableTotal')}</span>
              <span className="font-bold text-primary">{calc.cable} {t('units.M')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-secondary">🧱 {t('shtroba.chaseTotal')}</span>
              <span className="font-bold text-primary">{calc.chase} {t('units.LINEAR_METER')}</span>
            </div>
          </div>
        </div>
      )}

      {/* PARTITION — H/W/D + faces. */}
      {type === 'PARTITION' && (
        <div className="rounded-xl border border-border bg-surface-sunken p-3 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Input inputMode="decimal" placeholder={t('measure.height')} value={pDims.height}
              onChange={(e) => setPDims((s) => ({ ...s, height: e.target.value }))} />
            <Input inputMode="decimal" placeholder={t('measure.width')} value={pDims.width}
              onChange={(e) => setPDims((s) => ({ ...s, width: e.target.value }))} />
            <Input inputMode="decimal" placeholder={t('measure.depth')} value={pDims.depth}
              onChange={(e) => setPDims((s) => ({ ...s, depth: e.target.value }))} />
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-muted">{t('measure.facesHint')}</div>
            <div className="grid grid-cols-4 gap-2">
              <Toggle on={faces.left} label={t('measure.faceLeft')} onClick={() => setFaces((f) => ({ ...f, left: !f.left }))} />
              <Toggle on={faces.right} label={t('measure.faceRight')} onClick={() => setFaces((f) => ({ ...f, right: !f.right }))} />
              <Toggle on={faces.end} label={t('measure.faceEnd')} onClick={() => setFaces((f) => ({ ...f, end: !f.end }))} />
              <Toggle on={faces.top} label={t('measure.faceTop')} onClick={() => setFaces((f) => ({ ...f, top: !f.top }))} />
            </div>
          </div>
        </div>
      )}

      {/* LINEAR — H/W of the opening + sides + count. */}
      {type === 'LINEAR' && (
        <div className="rounded-xl border border-border bg-surface-sunken p-3 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Input inputMode="decimal" placeholder={t('measure.openingHeight')} value={lDims.height}
              onChange={(e) => setLDims((s) => ({ ...s, height: e.target.value }))} />
            <Input inputMode="decimal" placeholder={t('measure.openingWidth')} value={lDims.width}
              onChange={(e) => setLDims((s) => ({ ...s, width: e.target.value }))} />
            <Input inputMode="numeric" placeholder={t('measure.count')} value={lDims.qty}
              onChange={(e) => setLDims((s) => ({ ...s, qty: e.target.value }))} />
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-muted">{t('measure.sidesHint')}</div>
            <div className="grid grid-cols-4 gap-2">
              <Toggle on={sides.left} label={t('measure.sideLeft')} onClick={() => setSides((s) => ({ ...s, left: !s.left }))} />
              <Toggle on={sides.right} label={t('measure.sideRight')} onClick={() => setSides((s) => ({ ...s, right: !s.right }))} />
              <Toggle on={sides.top} label={t('measure.sideTop')} onClick={() => setSides((s) => ({ ...s, top: !s.top }))} />
              <Toggle on={sides.bottom} label={t('measure.sideBottom')} onClick={() => setSides((s) => ({ ...s, bottom: !s.bottom }))} />
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-3 text-sm text-muted">
        <span>{t('estimate.measureResult')}</span>
        <span className="text-base font-bold text-primary">{result} {t(unitKey)}</span>
      </div>

      {/* Review mode has no own footer — the parent sheet owns the single commit. */}
      {!reviewMode && (
        <div className="flex gap-2">
          <Button type="button" variant="secondary" fullWidth onClick={onCancel}>{t('common.cancel')}</Button>
          <Button type="button" fullWidth loading={saving} disabled={!canSave}
            onClick={() => onSave({ name: name.trim(), type, payload: buildPayload() })}>
            {t('common.save')}
          </Button>
        </div>
      )}
    </div>
  );
}
