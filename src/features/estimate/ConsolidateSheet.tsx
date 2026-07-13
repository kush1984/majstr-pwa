import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { estimatesApi } from '@/api/estimates.ts';
import { estimateName } from './estimateName.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { cn } from '@/lib/cn.ts';
import type { EstimateSummary } from '@/api/types.ts';

/**
 * Pick which of the object's estimates to fold into one new «Зведений кошторис».
 * The backend copies all their line items into a fresh DRAFT (works + materials,
 * with recomputed sums) — the same estimate editor opens afterwards. On success
 * the parent navigates to the new estimate.
 */
export function ConsolidateSheet({
  open,
  onClose,
  projectId,
  estimates,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  estimates: EstimateSummary[];
  onDone: (newEstimateId: string) => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Pre-fill the default title so the field is never empty; the master can rename it.
  const [name, setName] = useState(() => t('consolidate.defaultName'));

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const consolidate = useMutation({
    mutationFn: () =>
      estimatesApi.consolidate(projectId, {
        name: name.trim() || undefined,
        estimateIds: [...picked],
      }),
    onSuccess: (e) => {
      setPicked(new Set());
      setName(t('consolidate.defaultName'));
      onDone(e.id);
    },
    onError: (err) => toast.error(toAppError(err).message),
  });

  return (
    <Modal open={open} onClose={onClose} title={t('consolidate.title')}>
      <p className="mb-3 text-sm text-muted">{t('consolidate.hint')}</p>

      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('consolidate.namePlaceholder')}
        className="mb-3 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-primary placeholder:text-faint"
      />

      <div className="max-h-[45dvh] space-y-1.5 overflow-y-auto">
        {estimates.map((s) => {
          const checked = picked.has(s.id);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => toggle(s.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl border p-3 text-left',
                checked ? 'border-brand bg-brand-soft' : 'border-border bg-surface',
              )}
            >
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-md border text-xs',
                  checked ? 'border-brand bg-brand text-white' : 'border-border text-transparent',
                )}
              >
                ✓
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-primary">
                {estimateName(s.name, s.createdAt)}
              </span>
              <span className="text-xs text-muted">{t('status.estimate.' + s.status)}</span>
            </button>
          );
        })}
      </div>

      <Button
        fullWidth
        className="mt-4"
        disabled={picked.size < 2}
        loading={consolidate.isPending}
        onClick={() => consolidate.mutate()}
      >
        {picked.size < 2
          ? t('consolidate.pickAtLeastTwo')
          : t('consolidate.submit', { count: picked.size })}
      </Button>
    </Modal>
  );
}
