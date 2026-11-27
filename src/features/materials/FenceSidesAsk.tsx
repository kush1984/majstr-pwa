import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { materialsApi } from '@/api/materials.ts';
import { toAppError } from '@/api/errors.ts';
import type { MaterialCalculationResponse } from '@/api/types.ts';

/**
 * «Сторони паркану» — the one question asked as TEXT (V227): a 3D fence's sides, «25 + 15 + 25; 10».
 *
 * A panel does not bend round a corner and a gate breaks the run, so neither the panels nor the posts
 * follow from the line's м.п.: every side takes whole panels, and every run one post more than it has
 * panels. The answer is read on the SERVER (FenceSides), stored the way it reads it, and shown back
 * that way — so «25,15» taken as 25,15 m is on his screen, not in our assumption.
 *
 * Its own card and its own save, because every other question is ONE number: the figure cards bound,
 * parse and put their answers on the query string, and a list fits none of that. The answer travels
 * only through the store; the calculation reads it from there.
 */
export function FenceSidesAsk({
  estimateId,
  data,
  onSaved,
}: {
  estimateId: string;
  data: MaterialCalculationResponse | undefined;
  /** The answer changed the counts: the parent drops its hand-typed overrides and recalculates. */
  onSaved: () => Promise<unknown> | void;
}) {
  const { t } = useTranslation();
  const stored = data?.answers?.sides ?? {};
  const positions = fencePositions(data);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState<{ itemId: string; message: string } | null>(null);

  // His stored answer fills a field he has not touched yet — on this device or after a save.
  const storedKey = JSON.stringify(stored);
  useEffect(() => {
    const current = JSON.parse(storedKey) as Record<string, string>;
    setInputs((prev) => {
      const next = { ...prev };
      for (const [id, text] of Object.entries(current)) next[id] = text;
      return next;
    });
  }, [storedKey]);

  const save = useMutation({
    mutationFn: (sides: Record<string, string>) => materialsApi.saveParams(estimateId, { sides }),
    onSuccess: () => {
      setError(null);
      return onSaved();
    },
    onError: (err, sides) => {
      setError({ itemId: Object.keys(sides)[0] ?? '', message: toAppError(err).message });
    },
  });

  if (positions.length === 0) return null;
  const pending = positions.some((p) => !p.answered);
  const changed: Record<string, string> = {};
  for (const p of positions) {
    const text = (inputs[p.estimateItemId] ?? '').trim();
    if (text !== (stored[p.estimateItemId] ?? '')) changed[p.estimateItemId] = text;
  }
  // The screen's main action only once he has typed something to count: one primary per state.
  const dirty = Object.keys(changed).length > 0;

  const apply = () => {
    if (dirty) save.mutate(changed);
  };

  return (
    <div className="mb-4 rounded-card border border-border bg-surface p-3">
      <p className="text-sm font-semibold text-primary">
        {pending ? t('materials.sidesTitle') : t('materials.sidesTitleSet')}
      </p>
      {pending && <p className="mt-1 text-xs text-muted">{t('materials.sidesHint')}</p>}
      <div className="mt-2 space-y-2">
        {positions.map((p) => {
          const fieldId = `sides-${p.estimateItemId}`;
          const failed = error?.itemId === p.estimateItemId;
          return (
            <div key={p.estimateItemId}>
              <label htmlFor={fieldId} className="mb-1 block text-xs font-medium text-muted">
                {t('materials.positionWithUnit', { name: p.name, unit: t('materials.sidesUnit') })}
              </label>
              <Input
                id={fieldId}
                inputMode="text"
                autoComplete="off"
                value={inputs[p.estimateItemId] ?? ''}
                onChange={(e) => setInputs((prev) => ({ ...prev, [p.estimateItemId]: e.target.value }))}
                placeholder={t('materials.sidesPlaceholder')}
                aria-invalid={failed || undefined}
                aria-describedby={failed ? `${fieldId}-error` : undefined}
              />
              {failed && (
                <p id={`${fieldId}-error`} className="mt-1 text-xs text-danger">
                  {error.message}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {!pending && !save.isPending && !save.isError && (
        <p className="mt-2 text-[11px] text-muted">{t('materials.paramsRemembered')}</p>
      )}
      <Button
        variant={dirty ? 'primary' : 'secondary'}
        fullWidth
        className="mt-2"
        onClick={apply}
        loading={save.isPending}
        disabled={save.isPending}
      >
        {pending ? t('materials.sidesApply') : t('materials.recalculate')}
      </Button>
    </div>
  );
}

/**
 * The fence positions: still asking (from `parameters`), or answered (read off the arithmetic, so the
 * card stays to be corrected) — the same rule the figure cards follow, one entry per POSITION.
 */
function fencePositions(
  data: MaterialCalculationResponse | undefined,
): { estimateItemId: string; name: string; answered: boolean }[] {
  if (!data) return [];
  const byPosition = new Map<string, { estimateItemId: string; name: string; answered: boolean }>();
  for (const p of data.parameters) {
    if (p.parameter !== 'SIDES' || !p.estimateItemId || byPosition.has(p.estimateItemId)) continue;
    byPosition.set(p.estimateItemId, { estimateItemId: p.estimateItemId, name: p.positionName ?? '', answered: false });
  }
  for (const line of data.materials) {
    for (const s of line.sources) {
      if (s.basis !== 'SIDES' || !s.estimateItemId || byPosition.has(s.estimateItemId)) continue;
      byPosition.set(s.estimateItemId, { estimateItemId: s.estimateItemId, name: s.name ?? '', answered: true });
    }
  }
  return [...byPosition.values()];
}
