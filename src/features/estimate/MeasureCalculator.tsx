import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/Input.tsx';
import { Button } from '@/components/Button.tsx';
import { cn } from '@/lib/cn.ts';
import type { Unit } from '@/api/types.ts';

/**
 * Measure → quantity helper. The master enters side lengths and the panel
 * computes a quantity to drop into the line's quantity field — mirrors how
 * contractors size a job in Excel (length × width → m², or summed lengths →
 * linear metres, minus window/door openings). Dimensions are NOT persisted;
 * only the resulting number is applied.
 */

type Mode = 'area' | 'length';
type Seg = { l: string; w: string };
type Opening = { w: string; h: string; n: string };

const num = (s: string): number => {
  const n = Number(String(s).replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Pure calc, exported for tests. area = Σ(l·w) − Σ(w·h·n); length = Σl. Never negative. */
export function computeMeasure(mode: Mode, segs: Seg[], openings: Opening[]): number {
  const base = segs.reduce((s, r) => s + (mode === 'area' ? num(r.l) * num(r.w) : num(r.l)), 0);
  const sub =
    mode === 'area'
      ? openings.reduce((s, o) => s + num(o.w) * num(o.h) * (num(o.n) || 1), 0)
      : 0;
  return round3(Math.max(0, base - sub));
}

export function MeasureCalculator({
  unit,
  onApply,
  onClose,
}: {
  unit: Unit;
  onApply: (quantity: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>(
    unit === 'M' || unit === 'LINEAR_METER' ? 'length' : 'area',
  );
  const [segs, setSegs] = useState<Seg[]>([{ l: '', w: '' }]);
  const [openings, setOpenings] = useState<Opening[]>([]);

  const result = useMemo(() => computeMeasure(mode, segs, openings), [mode, segs, openings]);

  const setSeg = (i: number, k: keyof Seg, v: string) =>
    setSegs((p) => p.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
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

      <div className="space-y-2">
        {segs.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              inputMode="decimal"
              placeholder={t('estimate.measureLen')}
              value={r.l}
              onChange={(e) => setSeg(i, 'l', e.target.value)}
            />
            {mode === 'area' && (
              <>
                <span className="text-muted">×</span>
                <Input
                  inputMode="decimal"
                  placeholder={t('estimate.measureWidth')}
                  value={r.w}
                  onChange={(e) => setSeg(i, 'w', e.target.value)}
                />
              </>
            )}
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
        onClick={() => setSegs((p) => [...p, { l: '', w: '' }])}
        className="mt-2 text-xs font-semibold text-brand"
      >
        {t('estimate.measureAddRow')}
      </button>

      {mode === 'area' && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="mb-1.5 text-xs font-semibold text-muted">
            {t('estimate.measureOpenings')}
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
