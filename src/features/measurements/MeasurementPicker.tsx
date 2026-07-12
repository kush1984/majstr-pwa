import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { cn } from '@/lib/cn.ts';
import { useMeasurements } from './useMeasurements.ts';
import type { Unit } from '@/api/types.ts';

const fmtNum = (n: number): string => n.toLocaleString('uk-UA', { maximumFractionDigits: 3 });

/**
 * "Вибрати з замірів" — an inline picker (below the line form) that lists the object's
 * measured elements FILTERED to the line's unit (m² line → only M2 elements; м.пог → only
 * LINEAR). Multi-select with checkboxes; sums the picked results and applies it to the
 * quantity. Pre-checks the line's previous selection (memory). Warns if the quantity was
 * edited by hand (won't overwrite silently). The server recomputes the sum on save.
 */
export function MeasurementPicker({
  objectId,
  unit,
  selectedIds,
  quantityManual,
  onApply,
  onClose,
}: {
  objectId: string;
  unit: Unit;
  selectedIds: string[];
  quantityManual: boolean;
  onApply: (ids: string[], sum: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const tree = useMeasurements(objectId, true);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(selectedIds));

  // Only rooms/elements whose unit matches the line's unit.
  const rooms = useMemo(() => {
    const all = tree.data?.rooms ?? [];
    return all
      .map((r) => ({ ...r, items: r.items.filter((i) => i.unit === unit) }))
      .filter((r) => r.items.length > 0);
  }, [tree.data, unit]);

  const sum = useMemo(() => {
    let s = 0;
    for (const room of rooms) {
      for (const item of room.items) {
        if (checked.has(item.id)) s += item.result;
      }
    }
    return Math.round(s * 1000) / 1000;
  }, [rooms, checked]);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const unitLabel = t(unit === 'LINEAR_METER' ? 'units.LINEAR_METER' : 'units.M2');

  return (
    <div className="mt-2 rounded-xl border border-border bg-surface-sunken p-3">
      {quantityManual && (
        <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-700">
          {t('measurePick.manualWarning')}
        </p>
      )}

      {tree.isPending ? (
        <div className="py-6 text-center text-brand"><Spinner /></div>
      ) : rooms.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted">
          {t('measurePick.noneForUnit', { unit: unitLabel })}
        </p>
      ) : (
        <div className="max-h-[45dvh] space-y-3 overflow-y-auto">
          {rooms.map((room) => (
            <div key={room.id}>
              <div className="mb-1 text-xs font-bold text-primary">{room.name}</div>
              <div className="space-y-1">
                {room.items.map((item) => (
                  <label key={item.id}
                    className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                    <input type="checkbox" checked={checked.has(item.id)} onChange={() => toggle(item.id)}
                      className="h-4 w-4 rounded border-border text-brand focus:ring-brand-200" />
                    <span className="min-w-0 flex-1 truncate text-sm text-primary">{item.name}</span>
                    <span className="whitespace-nowrap text-sm font-semibold text-primary">
                      {fmtNum(item.result)} {unitLabel}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={cn('mt-3 flex items-center justify-between border-t border-border pt-3 text-sm text-muted')}>
        <span>{t('measurePick.total')}</span>
        <span className="text-base font-bold text-primary">{fmtNum(sum)} {unitLabel}</span>
      </div>
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="secondary" fullWidth onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="button" fullWidth disabled={rooms.length === 0}
          onClick={() => onApply([...checked], sum)}>
          {t('measurePick.apply')}
        </Button>
      </div>
    </div>
  );
}
