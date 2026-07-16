import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/Input.tsx';
import { Button } from '@/components/Button.tsx';
import { ShapeInput } from '@/components/ShapeInput.tsx';
import { cn } from '@/lib/cn.ts';
import {
  LENGTH_FACTOR,
  LENGTH_UNITS,
  newDraft,
  numOf,
  planesAreaM2,
  toPlane,
  type LengthUnit,
  type PlaneDraft,
} from '@/lib/shapes.ts';
import type { Unit } from '@/api/types.ts';

/**
 * Measure → quantity helper. The master enters side lengths and the panel computes a
 * quantity to drop into the line's quantity field — mirrors how contractors size a job
 * in Excel (area → m², or summed lengths → linear metres, minus openings).
 *
 * Area is built from planes of any shape via the shared `shapes` module — the same one
 * the object-measurements SURFACE editor uses, so the two always agree. Dimensions are
 * NOT persisted here; only the resulting number is applied.
 */

type Mode = 'area' | 'length';
type Seg = { l: string };
type Opening = { w: string; h: string; n: string };

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Σ lengths, converted to metres. Openings never apply to a length. */
export function sumLengths(segs: Seg[], unit: LengthUnit): number {
  const f = LENGTH_FACTOR[unit] ?? 1;
  return round3(Math.max(0, segs.reduce((s, r) => s + numOf(r.l), 0) * f));
}

/** Σ openings (w × h × count), converted to m². */
export function openingsAreaM2(openings: Opening[], unit: LengthUnit): number {
  const f = LENGTH_FACTOR[unit] ?? 1;
  return round3(
    openings.reduce((s, o) => s + numOf(o.w) * numOf(o.h) * (numOf(o.n) || 1) * f * f, 0),
  );
}

export function MeasureCalculator({
  unit: lineUnit,
  onApply,
  onClose,
}: {
  unit: Unit;
  onApply: (quantity: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>(
    lineUnit === 'M' || lineUnit === 'LINEAR_METER' ? 'length' : 'area',
  );
  // Metres by default — what every dimension in this panel meant before units existed.
  const [dimUnit, setDimUnit] = useState<LengthUnit>('M');
  const [planes, setPlanes] = useState<PlaneDraft[]>([newDraft('rect')]);
  const [segs, setSegs] = useState<Seg[]>([{ l: '' }]);
  const [openings, setOpenings] = useState<Opening[]>([]);

  const planesM2 = useMemo(() => planesAreaM2(planes.map(toPlane), dimUnit), [planes, dimUnit]);
  const openingsM2 = useMemo(() => openingsAreaM2(openings, dimUnit), [openings, dimUnit]);
  const result = useMemo(
    () =>
      mode === 'area'
        ? round3(Math.max(0, planesM2 - openingsM2))
        : sumLengths(segs, dimUnit),
    [mode, planesM2, openingsM2, segs, dimUnit],
  );

  const setOpening = (i: number, k: keyof Opening, v: string) =>
    setOpenings((p) => p.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));

  return (
    <div className="mt-2 rounded-xl border border-border bg-surface-sunken p-3">
      <div className="mb-3 flex gap-1 rounded-lg bg-surface p-1">
        {(['area', 'length'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              'flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors',
              mode === m ? 'bg-brand text-white' : 'text-muted',
            )}
          >
            {m === 'area' ? t('estimate.measureArea') : t('estimate.measureLength')}
          </button>
        ))}
      </div>

      {/* One unit for everything typed below. */}
      <div className="mb-3 flex justify-center gap-1.5">
        {LENGTH_UNITS.map((u) => (
          <button
            key={u}
            type="button"
            onClick={() => setDimUnit(u)}
            className={cn(
              'min-h-[44px] rounded-lg border px-3.5 text-xs font-semibold transition-colors',
              dimUnit === u ? 'border-brand bg-brand-soft text-brand' : 'border-border text-muted',
            )}
          >
            {t(`lengthUnit.${u}`)}
          </button>
        ))}
      </div>

      {mode === 'area' ? (
        <>
          <p className="mb-2 text-xs text-muted">{t('shape.hintTape')}</p>
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
                  unit={dimUnit}
                  onChange={(d) => setPlanes((prev) => prev.map((x, idx) => (idx === i ? d : x)))}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setPlanes((p) => [...p, newDraft('rect')])}
            className="mt-2 text-xs font-semibold text-brand"
          >
            {t('shape.addPlane')}
          </button>
        </>
      ) : (
        <>
          <div className="space-y-2">
            {segs.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  inputMode="decimal"
                  placeholder={t('estimate.measureLen')}
                  value={r.l}
                  onChange={(e) =>
                    setSegs((p) => p.map((x, idx) => (idx === i ? { l: e.target.value } : x)))
                  }
                />
                {segs.length > 1 && (
                  <button
                    type="button"
                    aria-label={t('common.delete')}
                    onClick={() => setSegs((p) => p.filter((_, idx) => idx !== i))}
                    className="px-1 text-muted"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setSegs((p) => [...p, { l: '' }])}
            className="mt-2 text-xs font-semibold text-brand"
          >
            {t('estimate.measureAddRow')}
          </button>
        </>
      )}

      {mode === 'area' && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="mb-1.5 text-xs font-semibold text-muted">
            {t('estimate.measureOpenings')} ({t(`lengthUnit.${dimUnit}`)})
          </div>
          <div className="space-y-2">
            {openings.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  inputMode="decimal"
                  placeholder={t('estimate.measureWidth')}
                  value={o.w}
                  onChange={(e) => setOpening(i, 'w', e.target.value)}
                />
                <span className="text-muted">×</span>
                <Input
                  inputMode="decimal"
                  placeholder={t('estimate.measureHeight')}
                  value={o.h}
                  onChange={(e) => setOpening(i, 'h', e.target.value)}
                />
                <span className="text-muted">×</span>
                <Input
                  inputMode="numeric"
                  placeholder={t('estimate.measureCount')}
                  value={o.n}
                  onChange={(e) => setOpening(i, 'n', e.target.value)}
                  className="w-16"
                />
                <button
                  type="button"
                  aria-label={t('common.delete')}
                  onClick={() => setOpenings((p) => p.filter((_, idx) => idx !== i))}
                  className="px-1 text-muted"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setOpenings((p) => [...p, { w: '', h: '', n: '1' }])}
            className="mt-2 text-xs font-semibold text-brand"
          >
            {t('estimate.measureAddOpening')}
          </button>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-sm text-muted">
        <span>{t('estimate.measureResult')}</span>
        <span className="text-base font-bold text-primary">
          {result} {t(mode === 'area' ? 'units.M2' : 'units.LINEAR_METER')}
        </span>
      </div>
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="secondary" fullWidth onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          type="button"
          fullWidth
          disabled={result <= 0}
          onClick={() => {
            onApply(result);
            onClose();
          }}
        >
          {t('estimate.measureApply')}
        </Button>
      </div>
    </div>
  );
}
