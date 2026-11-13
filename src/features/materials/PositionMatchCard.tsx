import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/Button.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { materialsApi } from '@/api/materials.ts';
import type { PositionMatch } from '@/api/types.ts';

/**
 * The lines whose materials are NOT counted, said plainly (V204). A line read under another spelling or
 * by its tile format is the same job and is counted silently — it is not listed. A line in his own
 * words that is close to one library position is asked ONCE: «це те саме, що …?». Anything else is his
 * own work: we do not guess, he adds its materials himself. Nothing is applied without his «так».
 */
export function PositionMatchCard({ matches, onChanged, onAddByHand }: {
  matches: PositionMatch[];
  onChanged: () => void;
  /** Opens the shopping list's own «add» form — where a material we do not count is written by hand. */
  onAddByHand?: () => void;
}) {
  const { t } = useTranslation();
  const save = useMutation({
    mutationFn: ({ m, key }: { m: PositionMatch; key: string | null }) =>
      materialsApi.saveAlias({ name: m.name, unit: m.unit, asNameKey: key }),
    onSuccess: () => {
      toast.success(t('positionMatch.saved'));
      onChanged();
    },
    onError: (err) => toast.error(toAppError(err).message),
  });
  const forget = useMutation({
    mutationFn: (m: PositionMatch) => materialsApi.deleteAlias(m.name, m.unit),
    onSuccess: onChanged,
    onError: (err) => toast.error(toAppError(err).message),
  });
  const shown = matches.filter((m) => m.kind !== 'RULE');
  if (shown.length === 0) return null;
  const busy = save.isPending || forget.isPending;
  const notCounted = shown.some((m) => m.kind === 'NO_MATERIALS' || (m.kind === 'UNMATCHED' && m.suggestions.length === 0));

  return (
    <div className="mb-4 rounded-card border border-border bg-surface p-3">
      <p className="text-sm font-semibold text-primary">{t('positionMatch.title')}</p>
      <div className="mt-2 space-y-2">
        {shown.map((m) => {
          const close = m.kind === 'UNMATCHED' ? m.suggestions[0] : undefined;
          return (
            <div key={m.estimateItemId} className={close ? 'rounded-xl bg-amber-soft p-2' : 'rounded-xl bg-surface-sunken p-2'}>
              <p className="text-xs font-semibold text-primary">{m.name}</p>
              {close ? (
                <>
                  <p className="mt-0.5 text-xs text-amber-strong">{t('positionMatch.sameAs', { name: close.name })}</p>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    <Button disabled={busy} onClick={() => save.mutate({ m, key: close.key })}>{t('positionMatch.yes')}</Button>
                    <Button variant="secondary" disabled={busy} onClick={() => save.mutate({ m, key: null })}>
                      {t('positionMatch.no')}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
                  <p className="text-xs text-muted">
                    {m.kind === 'MASTER'
                      ? t('positionMatch.countedAs', { name: m.asName ?? m.asKey ?? '' })
                      : t('positionMatch.notCounted')}
                  </p>
                  {m.kind !== 'UNMATCHED' && (
                    <button type="button" disabled={busy} onClick={() => forget.mutate(m)}
                      className="min-h-11 text-xs font-semibold text-brand-700 disabled:opacity-60">
                      {t('positionMatch.change')}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {notCounted && onAddByHand && (
        <Button variant="secondary" fullWidth className="mt-2" onClick={onAddByHand}>
          {t('positionMatch.addByHand')}
        </Button>
      )}
    </div>
  );
}
