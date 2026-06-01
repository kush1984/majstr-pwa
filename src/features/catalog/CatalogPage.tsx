import { useMemo, useState } from 'react';
import { Chip } from '@/components/Chip.tsx';
import { Button } from '@/components/Button.tsx';
import { Modal } from '@/components/Modal.tsx';
import { Skeleton } from '@/components/Skeleton.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { formatMoney } from '@/lib/format.ts';
import { unitPer } from '@/lib/labels.ts';
import type { CatalogItemResponse, ItemType } from '@/api/types.ts';
import { useCatalog, useResetCatalog } from './useCatalog.ts';
import { CatalogItemForm } from './CatalogItemForm.tsx';

const NO_CATEGORY = 'Без категорії';

type TypeFilter = ItemType | 'ALL';
const FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'ALL', label: 'Усі' },
  { value: 'WORK', label: 'Роботи' },
  { value: 'MATERIAL', label: 'Матеріали' },
];

/** Groups items by category, preserving the backend's category→name order. */
function groupByCategory(items: CatalogItemResponse[]): [string, CatalogItemResponse[]][] {
  const groups = new Map<string, CatalogItemResponse[]>();
  for (const item of items) {
    const key = item.category?.trim() || NO_CATEGORY;
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()];
}

export function CatalogPage() {
  const [filter, setFilter] = useState<TypeFilter>('ALL');
  const { data, isPending, isError, refetch, isFetching } = useCatalog(
    filter === 'ALL' ? undefined : filter,
  );
  const reset = useResetCatalog();

  // `undefined` = modal closed; `null` = create; an item = edit.
  const [editing, setEditing] = useState<CatalogItemResponse | null | undefined>(undefined);

  const groups = useMemo(() => groupByCategory(data ?? []), [data]);

  const onReset = async () => {
    try {
      const { added } = await reset.mutateAsync();
      toast.success(added > 0 ? `Додано ${added} позицій` : 'Стартовий набір вже у каталозі');
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-primary sm:text-[26px]">
          Каталог
        </h1>
        <Button onClick={() => setEditing(null)} className="hidden sm:inline-flex">
          + Додати позицію
        </Button>
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <Chip key={f.value} active={filter === f.value} onClick={() => setFilter(f.value)}>
            {f.label}
          </Chip>
        ))}
      </div>

      {isPending ? (
        <CatalogSkeleton />
      ) : isError ? (
        <ErrorBlock onRetry={() => void refetch()} />
      ) : (data?.length ?? 0) === 0 ? (
        <EmptyState
          icon="📖"
          title="Каталог порожній"
          text="Додайте позиції вручну або почніть зі стартового набору для ваших напрямів роботи."
          action={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="secondary" onClick={onReset} loading={reset.isPending}>
                Стартовий набір
              </Button>
              <Button onClick={() => setEditing(null)}>Додати позицію</Button>
            </div>
          }
        />
      ) : (
        <div className={isFetching ? 'opacity-60 transition-opacity' : undefined}>
          {groups.map(([category, items]) => (
            <section key={category} className="mb-5">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-brand">
                <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                {category} · {items.length}
              </div>
              <div className="space-y-1.5">
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setEditing(item)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 text-left transition-transform active:scale-[0.99]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-primary">
                        {item.name}
                      </span>
                      <span className="block text-xs text-muted">{unitPer(item.unit)}</span>
                    </span>
                    <span className="whitespace-nowrap text-sm font-bold text-primary">
                      {formatMoney(item.defaultPrice)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}

          <button
            type="button"
            onClick={() => setEditing(null)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-brand py-3 text-sm font-semibold text-brand"
          >
            + Додати позицію
          </button>
        </div>
      )}

      <Modal
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={editing ? 'Редагувати позицію' : 'Нова позиція'}
      >
        {/* keyed so the form fully resets between create/edit targets */}
        <CatalogItemForm
          key={editing?.id ?? 'new'}
          initial={editing ?? null}
          onDone={() => setEditing(undefined)}
        />
      </Modal>
    </>
  );
}

function CatalogSkeleton() {
  return (
    <div className="space-y-5">
      {[0, 1].map((g) => (
        <div key={g}>
          <Skeleton className="mb-2 h-3 w-28" />
          <div className="space-y-1.5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorBlock({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      icon="⚠️"
      title="Не вдалося завантажити каталог"
      text="Перевірте з'єднання та спробуйте ще раз."
      action={<Button onClick={onRetry}>Спробувати знову</Button>}
    />
  );
}
