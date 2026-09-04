import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { routes } from '@/lib/config.ts';
import { Chip } from '@/components/Chip.tsx';
import { Input } from '@/components/Input.tsx';
import { Button } from '@/components/Button.tsx';
import { Modal } from '@/components/Modal.tsx';
import { Skeleton } from '@/components/Skeleton.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { Fab, FabAction } from '@/components/Fab.tsx';
import { ErrorState } from '@/components/ErrorState.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { cn } from '@/lib/cn.ts';
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
import { TradeLevel, tradeBranchLabel } from './TradeLevel.tsx';
import { toTradeTree, tradeKeyOf } from './catalogTree.ts';

type TypeFilter = ItemType | 'ALL';
const FILTERS: { value: TypeFilter; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'common.all' },
  { value: 'WORK', labelKey: 'catalog.filterWorks' },
  { value: 'MATERIAL', labelKey: 'catalog.filterMaterials' },
];

/** Same rule as the picker: at or below this many positions a level opens by itself, because a
 *  short list was never the problem and collapsing it would only add a tap. */
const AUTO_EXPAND_MAX_ITEMS = 10;
/** Below this the search box is noise — a master can see his whole catalog without it. */
const SEARCH_FROM = 8;

/**
 * The master's own catalog: TRADE → CATEGORY → position, collapsible.
 *
 * <p><b>The trade chips are gone.</b> They were kept here one round longer than the pickers' on the
 * argument that this page's filter does two extra jobs — it prefilled a new position's trade and it
 * defined what «Видалити все» deletes — but on a phone a filter row that must be scrolled sideways
 * to find out a trade even exists is the thing the tree fixes: «на мобільних так реально простіше».
 * Both jobs survive without it: the prefill now fires when the master's catalog holds exactly ONE
 * trade (the only case a filter could ever have answered unambiguously), and «Видалити все» means
 * the whole catalog under the TYPE filter — which is what the confirm says out loud.</p>
 */
export function CatalogPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<TypeFilter>('ALL');
  const [q, setQ] = useState('');
  const [openState, setOpenState] = useState<Record<string, boolean>>({});
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
  /** Tick or untick a whole folder or a whole trade at once. */
  const toggleMany = (ids: string[], select: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (select ? next.add(id) : next.delete(id)));
      return next;
    });

  // Everything under the TYPE filter (Усі/Роботи/Матеріали). This — not what search leaves on
  // screen — is what «Видалити все» means, and it is also what tells a genuinely empty catalog
  // apart from a search that matched nothing.
  const underType = useMemo(
    () => (data ?? []).filter((i) => filter === 'ALL' || i.type === filter),
    [data, filter],
  );
  const searching = q.trim().length > 0;
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle === '' ? underType : underType.filter((i) => i.name.toLowerCase().includes(needle));
  }, [underType, q]);

  const branches = useMemo(() => toTradeTree(visible), [visible]);
  // One branch = nothing for a trade level to disambiguate, so it is not drawn and the folders sit
  // at the top level, exactly as they did before the tree.
  const showTrades = branches.length > 1;
  const autoOpenTrade = !showTrades || visible.length <= AUTO_EXPAND_MAX_ITEMS;
  const isOpen = (key: string, fallback: boolean) => searching || (openState[key] ?? fallback);
  const toggleOpen = (key: string, fallback: boolean) =>
    setOpenState((prev) => ({ ...prev, [key]: !(prev[key] ?? fallback) }));

  // Prefill a new position's trade when the master's WHOLE catalog holds exactly one — the only
  // case the old chip filter could ever answer unambiguously either. Computed over everything, not
  // over the current view, so a search narrowing the screen to one trade does not decide it.
  const defaultTradeKey = useMemo(() => {
    const keys = new Set((data ?? []).map(tradeKeyOf));
    return keys.size === 1 ? [...keys][0] : undefined;
  }, [data]);

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

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <Chip key={f.value} active={filter === f.value} onClick={() => setFilter(f.value)}>
            {t(f.labelKey)}
          </Chip>
        ))}
      </div>

      {/* The control that actually shortens a 900-position list, and the one the trade chips could
          never be: it opens every branch while it runs, so no collapsed folder can hide a hit. */}
      {(data?.length ?? 0) > SEARCH_FROM && (
        <Input
          placeholder={t('estimate.searchCatalog')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="mb-4"
        />
      )}

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
      ) : underType.length > 0 && visible.length === 0 ? (
        // A search that matched nothing is NOT an empty catalog — the onboarding below would offer
        // «Стартовий набір» over a catalog that is already full.
        <p className="py-10 text-center text-sm text-muted">{t('catalog.nothingFound')}</p>
      ) : underType.length === 0 ? (
        // Nothing to show — whether the catalog is genuinely empty OR the type filter matched
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

          <div className="space-y-2">
            {branches.map((branch) => {
              // A position two trades both ship appears in both branches under ONE id, so ticking
              // a whole trade with a Set can never double-count it.
              const ids = branch.sections.flatMap((s) => s.items.map((i) => i.id));
              const allPicked = picked !== null && ids.every((id) => picked.has(id));
              const pickedHere = picked === null ? 0 : ids.filter((id) => picked.has(id)).length;
              // Inside ONE trade the old rule still applies: a short trade opens its folders, a
              // long one shows them closed.
              const autoOpenCategory =
                branch.sections.length <= 1 || branch.count <= AUTO_EXPAND_MAX_ITEMS;
              return (
                <TradeLevel
                  key={branch.key}
                  show={showTrades}
                  tradeKey={branch.key}
                  customName={branch.customName}
                  count={branch.count}
                  badge={pickedHere}
                  open={isOpen(`t:${branch.key}`, autoOpenTrade)}
                  onToggle={
                    searching ? undefined : () => toggleOpen(`t:${branch.key}`, autoOpenTrade)
                  }
                  testId="catalog-trade"
                  bodyClass="space-y-2"
                  leading={
                    /* Dropping a whole trade a master does not do is the bulk delete he actually
                       reaches for — a hundred rows, not five — and the chips never offered it. */
                    picked !== null && (
                      <button
                        type="button"
                        onClick={() => toggleMany(ids, !allPicked)}
                        aria-pressed={allPicked}
                        aria-label={tradeBranchLabel(branch.key, branch.customName, t)}
                        className="flex h-11 w-7 flex-shrink-0 items-center justify-center"
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'flex h-5 w-5 items-center justify-center rounded border text-[11px] font-bold',
                            allPicked ? 'border-brand bg-brand text-white' : 'border-border text-transparent',
                          )}
                        >
                          ✓
                        </span>
                      </button>
                    )
                  }
                >
                  <CatalogBoard
                    sections={branch.sections}
                    onEdit={setEditing}
                    isCategoryOpen={(category) =>
                      isOpen(`c:${branch.key}|${category}`, autoOpenCategory)
                    }
                    onToggleCategory={
                      searching
                        ? undefined
                        : (category) =>
                            toggleOpen(`c:${branch.key}|${category}`, autoOpenCategory)
                    }
                    selection={picked === null ? undefined : {
                      selected: picked,
                      onToggle: (id) => setPicked((prev) => {
                        const next = new Set(prev);
                        if (!next.delete(id)) next.add(id);
                        return next;
                      }),
                      onToggleSection: toggleMany,
                    }}
                  />
                </TradeLevel>
              );
            })}
          </div>

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

      {/* «Все» means everything under the TYPE filter — never what search leaves on screen —
          and the message says the number out loud: deleting rows a master cannot see is not
          something a confirm can make safe. */}
      <ConfirmDialog
        open={deleteAllOpen}
        title={t('catalog.deleteAllTitle')}
        message={t('catalog.deleteAllMessage', { count: underType.length })}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          const ids = underType.map((i) => i.id);
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

