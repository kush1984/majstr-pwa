import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chip } from '@/components/Chip.tsx';
import { Button } from '@/components/Button.tsx';
import { Modal } from '@/components/Modal.tsx';
import { Skeleton } from '@/components/Skeleton.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { ErrorState } from '@/components/ErrorState.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { formatMoney } from '@/lib/format.ts';
import i18n from '@/lib/i18n.ts';
import type { CatalogItemResponse, ItemType } from '@/api/types.ts';
import {
  useAddNewFromTemplate,
  useCatalog,
  useCheckTemplateUpdates,
  useResetCatalog,
} from './useCatalog.ts';
import { CatalogItemForm } from './CatalogItemForm.tsx';

type TypeFilter = ItemType | 'ALL';
const FILTERS: { value: TypeFilter; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'common.all' },
  { value: 'WORK', labelKey: 'catalog.filterWorks' },
  { value: 'MATERIAL', labelKey: 'catalog.filterMaterials' },
];

/** Groups items by category, preserving the backend's category→name order. */
function groupByCategory(items: CatalogItemResponse[]): [string, CatalogItemResponse[]][] {
  const noCategory = i18n.t('catalog.noCategory');
  const groups = new Map<string, CatalogItemResponse[]>();
  for (const item of items) {
    const key = item.category?.trim() || noCategory;
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()];
}

export function CatalogPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<TypeFilter>('ALL');
  const { data, isPending, isError, error, refetch, isFetching } = useCatalog(
    filter === 'ALL' ? undefined : filter,
  );
  const reset = useResetCatalog();
  const checkUpdates = useCheckTemplateUpdates();
  const addNew = useAddNewFromTemplate();

  // `undefined` = modal closed; `null` = create; an item = edit.
  const [editing, setEditing] = useState<CatalogItemResponse | null | undefined>(undefined);
  // "Add new from library" flow: a count opens the confirm; `nothingNew` opens the info dialog.
  const [pendingNewCount, setPendingNewCount] = useState<number | null>(null);
  const [nothingNew, setNothingNew] = useState(false);

  const groups = useMemo(() => groupByCategory(data ?? []), [data]);

  const onReset = async () => {
    try {
      const { itemsAdded } = await reset.mutateAsync();
      toast.success(
        itemsAdded > 0
          ? t('catalog.itemsAdded', { count: itemsAdded })
          : t('catalog.starterAlreadyPresent'),
      );
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const onCheckUpdates = async () => {
    try {
      const { available } = await checkUpdates.mutateAsync();
      if (available > 0) setPendingNewCount(available);
      else setNothingNew(true);
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const onAddNew = async () => {
    try {
      const { itemsAdded } = await addNew.mutateAsync();
      toast.success(t('catalog.addNewAdded', { count: itemsAdded }));
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setPendingNewCount(null);
    }
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-primary sm:text-[26px]">
          {t('catalog.title')}
        </h1>
        <Button onClick={() => setEditing(null)} className="hidden sm:inline-flex">
          {t('catalog.addItem')}
        </Button>
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <Chip key={f.value} active={filter === f.value} onClick={() => setFilter(f.value)}>
            {t(f.labelKey)}
          </Chip>
        ))}
      </div>

      {isPending ? (
        <CatalogSkeleton />
      ) : isError ? (
        <ErrorState
          error={error}
          title={t('catalog.loadErrorTitle')}
          onRetry={() => void refetch()}
        />
      ) : (data?.length ?? 0) === 0 ? (
        <EmptyState
          icon="📖"
          title={t('catalog.emptyTitle')}
          text={t('catalog.emptyText')}
          action={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="secondary" onClick={onReset} loading={reset.isPending}>
                {t('catalog.starterSet')}
              </Button>
              <Button onClick={() => setEditing(null)}>{t('catalog.addItemShort')}</Button>
            </div>
          }
        />
      ) : (
        <div className={isFetching ? 'opacity-60 transition-opacity' : undefined}>
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={onCheckUpdates}
              disabled={checkUpdates.isPending}
              className="text-xs font-semibold text-brand disabled:opacity-50"
            >
              {checkUpdates.isPending ? t('catalog.addNewChecking') : `↻ ${t('catalog.addNew')}`}
            </button>
          </div>

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
                      <span className="block text-xs text-muted">
                      {t('unitPer', { unit: t('units.' + item.unit) })}
                    </span>
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
            {t('catalog.addItem')}
          </button>
        </div>
      )}

      <Modal
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={editing ? t('catalog.editItemTitle') : t('catalog.newItemTitle')}
      >
        {/* keyed so the form fully resets between create/edit targets */}
        <CatalogItemForm
          key={editing?.id ?? 'new'}
          initial={editing ?? null}
          onDone={() => setEditing(undefined)}
        />
      </Modal>

      <Modal
        open={pendingNewCount !== null}
        onClose={() => setPendingNewCount(null)}
        title={t('catalog.addNewTitle')}
      >
        <p className="mb-5 text-sm text-muted">
          {t('catalog.addNewPrompt', { count: pendingNewCount ?? 0 })}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" fullWidth onClick={() => setPendingNewCount(null)}>
            {t('common.cancel')}
          </Button>
          <Button fullWidth loading={addNew.isPending} onClick={onAddNew}>
            {t('catalog.addNewConfirm')}
          </Button>
        </div>
      </Modal>

      <Modal
        open={nothingNew}
        onClose={() => setNothingNew(false)}
        title={t('catalog.addNewNothingTitle')}
      >
        <p className="mb-5 text-sm text-muted">{t('catalog.addNewNothing')}</p>
        <Button fullWidth onClick={() => setNothingNew(false)}>
          {t('common.close')}
        </Button>
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

