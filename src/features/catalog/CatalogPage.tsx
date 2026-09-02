import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { routes } from '@/lib/config.ts';
import { Chip } from '@/components/Chip.tsx';
import { Button } from '@/components/Button.tsx';
import { Modal } from '@/components/Modal.tsx';
import { Skeleton } from '@/components/Skeleton.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { Fab, FabAction } from '@/components/Fab.tsx';
import { ErrorState } from '@/components/ErrorState.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import type { CatalogItemResponse, ItemType } from '@/api/types.ts';
import { useOnlineGuard } from '@/hooks/useOnlineGuard.ts';
import {
  useAddNewFromTemplate,
  useCatalog,
  useCheckTemplateUpdates,
  useResetCatalog,
  useDeleteCatalogItems,
} from './useCatalog.ts';
import { CatalogItemForm } from './CatalogItemForm.tsx';
import { CatalogBoard } from './CatalogBoard.tsx';
import { TradeFilterChips, tradeMatches, type TradeKey } from './TradeFilterChips.tsx';
import { asSelectedTradeSees } from './sharedCategory.ts';

type TypeFilter = ItemType | 'ALL';
const FILTERS: { value: TypeFilter; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'common.all' },
  { value: 'WORK', labelKey: 'catalog.filterWorks' },
  { value: 'MATERIAL', labelKey: 'catalog.filterMaterials' },
];

export function CatalogPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<TypeFilter>('ALL');
  const [tradeFilter, setTradeFilter] = useState<Set<TradeKey>>(new Set());
  // Fetch the WHOLE catalog and filter by type client-side: only then can we tell a genuinely
  // empty catalog (→ onboarding) apart from a filter that simply matched nothing (→ a light hint).
  // Server-side type filtering made «Матеріали» on a works-only catalog look like an empty catalog.
  const { data, isPending, isError, error, refetch } = useCatalog();
  const reset = useResetCatalog();
  const checkUpdates = useCheckTemplateUpdates();
  const addNew = useAddNewFromTemplate();
  // The starter-set / add-new-from-library flows are server-side merges — they can't be queued.
  const { online, guard, offlineTitle } = useOnlineGuard();

  // `undefined` = modal closed; `null` = create; an item = edit.
  const [editing, setEditing] = useState<CatalogItemResponse | null | undefined>(undefined);
  // "Add new from library" flow: a count opens the confirm; `nothingNew` opens the info dialog.
  const [pendingNewCount, setPendingNewCount] = useState<number | null>(null);
  const [nothingNew, setNothingNew] = useState(false);
  // Selection mode: `null` = off, which is what keeps an ordinary tap meaning exactly one thing.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const deleteItems = useDeleteCatalogItems();

  // Trade narrows the SET; the type chips (Усі/Роботи/Матеріали) filter within it — both client-side.
  const visible = useMemo(
    () => asSelectedTradeSees(
      (data ?? [])
        .filter((i) => filter === 'ALL' || i.type === filter)
        .filter((i) => tradeMatches(i, tradeFilter)),
      tradeFilter,
    ),
    [data, filter, tradeFilter],
  );
  // Prefill a new item's trade when the filter narrows to exactly one trade
  // (including "Інше"/OTHER, or a custom trade — now a real filter target).
  // Ambiguous under a multi-select.
  const defaultTradeKey = tradeFilter.size === 1 ? [...tradeFilter][0] : undefined;

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
      {/* Adding a position lives only in the FAB now (same as elsewhere), so the title is a plain
          left-aligned heading like «Мої шаблони» / «Обʼєкти». */}
      <h1 className="mb-4 text-2xl font-extrabold tracking-tight text-primary sm:text-[26px]">
        {t('catalog.title')}
      </h1>

      <TradeFilterChips items={data ?? []} value={tradeFilter} onChange={setTradeFilter} />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <Chip key={f.value} active={filter === f.value} onClick={() => setFilter(f.value)}>
            {t(f.labelKey)}
          </Chip>
        ))}
      </div>

      {isPending ? (
        <CatalogSkeleton />
      ) : isError && !data ? (
        // Cached catalog stays usable offline (it's what estimates are built from).
        <ErrorState
          error={error}
          title={t('catalog.loadErrorTitle')}
          what={t('offline.dataCatalog')}
          onRetry={() => void refetch()}
        />
      ) : visible.length === 0 ? (
        // Nothing to show — whether the catalog is genuinely empty OR the current filter matched
        // none. Same onboarding either way ON PURPOSE: it carries «Стартовий набір», the master's
        // one path to restore the default catalog after clearing it (incl. under a filter).
        <EmptyState
          icon="📖"
          title={t('catalog.emptyTitle')}
          text={t('catalog.emptyText')}
          action={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="secondary"
                onClick={guard(() => void onReset())}
                loading={reset.isPending}
                disabled={!online}
                title={offlineTitle}
              >
                {t('catalog.starterSet')}
              </Button>
              <Button variant="secondary" onClick={() => navigate(routes.catalogImport)}>
                {t('catalog.importPrice')}
              </Button>
              <Button onClick={() => setEditing(null)}>{t('catalog.addItemShort')}</Button>
            </div>
          }
        />
      ) : (
        <div>
          <div className="mb-4 flex justify-end gap-4">
            <button
              type="button"
              onClick={() => navigate(routes.catalogImport)}
              className="text-xs font-semibold text-brand"
            >
              ⬆ {t('catalog.importPrice')}
            </button>
            <button
              type="button"
              onClick={guard(() => void onCheckUpdates())}
              disabled={checkUpdates.isPending || !online}
              title={offlineTitle}
              className="text-xs font-semibold text-brand disabled:opacity-50"
            >
              {checkUpdates.isPending ? t('catalog.addNewChecking') : `↻ ${t('catalog.addNew')}`}
            </button>
          </div>

          <CatalogBoard
            items={visible}
            onEdit={setEditing}
            selection={picked === null ? undefined : {
              selected: picked,
              onToggle: (id) => setPicked((prev) => {
                const next = new Set(prev);
                if (!next.delete(id)) next.add(id);
                return next;
              }),
              onToggleSection: (ids, select) => setPicked((prev) => {
                const next = new Set(prev);
                ids.forEach((id) => (select ? next.add(id) : next.delete(id)));
                return next;
              }),
            }}
          />

          {picked !== null && (
            /* Sticky INSIDE the list, and `ml-8` clears the checkbox column so the bar is the width
               of a POSITION card, not the full row — same as the estimate selection bar. The bottom
               offset clears the mobile nav, which is lg:hidden. */
            <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 ml-8 mt-2 flex items-center gap-3 rounded-2xl bg-ink px-4 py-3 shadow-card-lg lg:bottom-4">
              <span className="flex-shrink-0 text-sm font-semibold text-white">
                {t('catalog.selectedCount', { count: picked.size })}
              </span>
              <div className="ml-auto flex flex-shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={picked.size === 0}
                  onClick={() => setBulkDeleteOpen(true)}
                  className="min-h-[44px] rounded-xl bg-danger px-5 text-sm font-semibold text-white disabled:bg-white/15 disabled:text-white/40"
                >
                  {t('common.delete')}
                </button>
                <button
                  type="button"
                  onClick={() => setPicked(null)}
                  className="min-h-[44px] rounded-xl px-3 text-sm font-semibold text-white/70"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* The catalog had no FAB at all — every action lived in small links above the list, which
          is the one place a thumb does not reach on a phone. */}
      <Fab ariaLabel={t('catalog.actionsMenu')}>
        {(close) => (
          <>
            <FabAction icon="＋" label={t('catalog.addItemShort')}
              onClick={() => close(() => setEditing(null))} />
            <FabAction icon="☑" label={t('catalog.selectItems')}
              onClick={() => close(() => setPicked(new Set()))} />
            <FabAction icon="🗑" label={t('catalog.deleteAll')}
              onClick={() => close(() => setDeleteAllOpen(true))} />
          </>
        )}
      </Fab>

      <ConfirmDialog
        open={bulkDeleteOpen}
        title={t('catalog.deleteSelectedTitle')}
        message={t('catalog.deleteSelectedMessage', { count: picked?.size ?? 0 })}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          const ids = [...(picked ?? [])];
          setBulkDeleteOpen(false);
          setPicked(null);
          deleteItems.mutate(ids, {
            onSuccess: () => toast.success(t('catalog.deleted', { count: ids.length })),
            onError: (err) => toast.error(toAppError(err).message),
          });
        }}
        onClose={() => setBulkDeleteOpen(false)}
      />

      {/* «Все» means everything the CURRENT FILTER shows, and the message says the number out
          loud — deleting rows a master cannot see is not something a confirm can make safe. */}
      <ConfirmDialog
        open={deleteAllOpen}
        title={t('catalog.deleteAllTitle')}
        message={t('catalog.deleteAllMessage', { count: visible.length })}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          const ids = visible.map((i) => i.id);
          setDeleteAllOpen(false);
          setPicked(null);
          deleteItems.mutate(ids, {
            onSuccess: () => toast.success(t('catalog.deleted', { count: ids.length })),
            onError: (err) => toast.error(toAppError(err).message),
          });
        }}
        onClose={() => setDeleteAllOpen(false)}
      />

      <Modal
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={editing ? t('catalog.editItemTitle') : t('catalog.newItemTitle')}
      >
        {/* keyed so the form fully resets between create/edit targets */}
        <CatalogItemForm
          key={editing?.id ?? 'new'}
          initial={editing ?? null}
          defaultTradeKey={defaultTradeKey}
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
          {/* Adding a position works offline — `useCreateCatalogItem` queues it through the
              outbox — so this must not be gated. Resetting the catalog and checking for new
              default positions above genuinely do need the server and stay gated. */}
          <Button
            fullWidth
            loading={addNew.isPending}
            onClick={() => void onAddNew()}
          >
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

