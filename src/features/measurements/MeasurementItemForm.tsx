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
import type {
  LinearPayload,
  MeasurementItem,
  MeasurementItemRequest,
  MeasurementType,
  PartitionPayload,
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
];

export function MeasurementItemForm({
  initial,
  onSave,
  onCancel,
  saving,
  hostUnit,
  onLiveChange,
}: {
  initial?: MeasurementItem;
  onSave: (req: MeasurementItemRequest) => void;
  onCancel: () => void;
  saving?: boolean;
  /** Review mode (sketch import): the SURFACE unit is driven by the parent's sheet-level
   *  switch instead of this form's own, so one dial reinterprets every element at once. */
  hostUnit?: LengthUnit;
  /** Review mode: report the current request live (null = not yet valid) and hide the
   *  Save/Cancel footer — the parent owns the single commit. */
  onLiveChange?: (req: MeasurementItemRequest | null) => void;
}) {
  const { t } = useTranslation();
  const reviewMode = onLiveChange != null;
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<MeasurementType>(initial?.type ?? 'SURFACE');

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

  // Surface sub-totals, in m² — shown so the master can check the arithmetic.
  const planesM2 = useMemo(() => planesAreaM2(planes.map(toPlane), unit), [planes, unit]);
  const openingsM2 = useMemo(() => {
    const f = LENGTH_FACTOR[unit];
    return round3(
      openings.reduce((s, o) => s + num(o.w) * num(o.h) * posInt(o.n) * f * f, 0),
    );
  }, [openings, unit]);

  const result = useMemo(() => {
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
  }, [type, planesM2, openingsM2, pDims, faces, lDims, sides]);

  const unitKey = type === 'LINEAR' ? 'units.LINEAR_METER' : 'units.M2';

  const buildPayload = (): MeasurementItemRequest['payload'] => {
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

      {/* Type picker (only for a new element; editing keeps the type fixed). */}
      {!initial && (
        <div className="grid grid-cols-3 gap-2">
          {TYPES.map((ty) => (
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
