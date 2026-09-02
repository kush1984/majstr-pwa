import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/Input.tsx';
import { Button } from '@/components/Button.tsx';
import { Chip } from '@/components/Chip.tsx';
import { InfoPopover } from '@/components/InfoPopover.tsx';
import { OfflineNotCached } from '@/components/OfflineNotCached.tsx';
import { useOnline } from '@/lib/useOnline.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { formatMoney } from '@/lib/format.ts';
import { cn } from '@/lib/cn.ts';
import { TRADE_EMOJI, CUSTOM_TRADE_EMOJI } from '@/lib/labels.ts';
import { useCatalog } from './useCatalog.ts';
import { parseCustomTradeKey } from './TradeFilterChips.tsx';
import { toTradeTree, type TradeBranch } from './catalogTree.ts';
import type { CatalogItemResponse, ItemType, Trade } from '@/api/types.ts';

type TypeFilter = ItemType | 'ALL';

const TYPE_FILTERS: { value: TypeFilter; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'common.all' },
  { value: 'WORK', labelKey: 'catalog.filterWorks' },
  { value: 'MATERIAL', labelKey: 'catalog.filterMaterials' },
];

/**
 * At or below this many positions a level opens by default — the trades over the whole catalog,
 * the folders inside one trade: a flat list was never the problem at this size, and collapsing it
 * would only add a tap. Above it the master gets the headings first — which is the whole point
 * («не навантажуй відразу всім»).
 */
const AUTO_EXPAND_MAX_ITEMS = 10;

/**
 * THE catalog picker. One component behind every "add a position" surface — the estimate editor,
 * the template editor (add + replace), and an act's additional works — so the screen is learned
 * once. Before it there were two near-identical copies plus a surface with no browse at all, and
 * only the copies could ever be fixed together.
 *
 * <p>Positions are a TREE — trade → category → position, collapsed — because the flat list is what
 * a master told us was unusable: «не класифіковано, не систематизовано, плоскі списки, логічна
 * цепочка як дерево програми просто відсутня». The grouping is {@link toTradeTree} over
 * {@link toSections}, the same function the catalog page groups by, so a category means exactly
 * the same thing on both screens and comes out in the library's execution order.</p>
 *
 * <p><b>Trade is a LEVEL, and there are no chips.</b> It used to be a chip row on the argument that
 * a master works one trade and a level would be a tap answering nothing — true of him then, false
 * of him now: with several trades ticked the folders were contiguous per trade but unlabelled, so
 * «не зрозуміло яка категорія до чого відноситься», which is the same complaint the folders were
 * built to answer, one level up. The tree says it outright and needs no filter to do it. A single
 * branch renders no trade level at all (the rule the chips already had — they hid themselves under
 * two), so a one-trade master sees exactly what he saw before.</p>
 *
 * <p><b>Search shows only the categories that HAVE a hit, and flattens nothing.</b> A category
 * with no match does not render at all; the ones that remain are expanded and their header is
 * inert: the heading still says where a hit lives (that is the "logical chain"), but a section
 * collapsed earlier while browsing can never swallow a result. Browsing is what the folders are
 * for; search is for when you already know the name.</p>
 */
export function CatalogPicker({
  disabledNames,
  single,
  hint,
  listHeightClass = 'max-h-[40dvh]',
  onPick,
}: {
  /** Positions already present where the pick lands — rendered greyed and untappable. Matched on
   *  the lowercased trimmed NAME, the key the backend itself dedups a bundle by. */
  disabledNames?: readonly string[];
  /** A replacement picker for ONE position: a tap applies straight away, with no basket to confirm
   *  and no success toast — there is nothing to accumulate when only one position can win. */
  single?: boolean;
  /** Shown above the confirm button (e.g. «Кількість буде 1 — поправите в кошторисі»). */
  hint?: ReactNode;
  /** The scroll box's height cap — a sheet that also carries a form wants a shorter list. */
  listHeightClass?: string;
  /** Perform the write. The caller maps catalog items to its own payload (an estimate line, a
   *  template item, an additional work); everything around it — busy state, the error toast, the
   *  success toast, clearing the basket — lives here so the callers cannot drift on it. */
  onPick: (items: CatalogItemResponse[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const { data, isPending } = useCatalog();
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openState, setOpenState] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const blocked = useMemo(
    () => new Set((disabledNames ?? []).map((n) => n.trim().toLowerCase())),
    [disabledNames],
  );

  const searching = q.trim().length > 0;

  // The flat, DEDUPED list — one entry per position, whatever the tree does with it. It is what
  // the basket adds and what decides "nothing found", so a position two branches both show can
  // never be added twice or counted twice.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? [])
      .filter((i) => typeFilter === 'ALL' || i.type === typeFilter)
      .filter((i) => !needle || i.name.toLowerCase().includes(needle));
  }, [data, q, typeFilter]);

  const branches = useMemo(() => toTradeTree(filtered), [filtered]);

  // One branch = nothing for a trade level to disambiguate, so it is not drawn and its categories
  // sit at the top level, exactly as they did before the tree.
  const showTrades = branches.length > 1;
  const autoOpenTrade = !showTrades || filtered.length <= AUTO_EXPAND_MAX_ITEMS;
  const isOpen = (key: string, fallback: boolean) => searching || (openState[key] ?? fallback);
  const toggleOpen = (key: string, fallback: boolean) =>
    setOpenState((prev) => ({ ...prev, [key]: !(prev[key] ?? fallback) }));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async (items: CatalogItemResponse[], announce: boolean) => {
    if (items.length === 0 || busy) return;
    setBusy(true);
    try {
      await onPick(items);
      if (announce) toast.success(t('estimate.itemsAdded', { count: items.length }));
      setSelected(new Set());
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setBusy(false);
    }
  };

  // Catalog order, NOT the order the rows happened to be tapped: nothing on screen numbers the
  // taps, so tap order is an arrangement the master cannot see. Picking five positions across two
  // categories lands them grouped the way he keeps them.
  const addSelected = () => run(filtered.filter((i) => selected.has(i.id)), true);

  return (
    <div>
      <div className="mb-3 flex gap-2">
        {TYPE_FILTERS.map((f) => (
          <Chip key={f.value} active={typeFilter === f.value} onClick={() => setTypeFilter(f.value)}>
            {t(f.labelKey)}
          </Chip>
        ))}
      </div>
      <Input
        placeholder={t('estimate.searchCatalog')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="mb-3"
      />

      <div className={cn('space-y-2 overflow-y-auto', listHeightClass)}>
        {isPending ? (
          <p className="py-6 text-center text-sm text-muted">{t('common.loading')}</p>
        ) : !online && (data?.length ?? 0) === 0 ? (
          // Nothing cached at all — the master's catalog exists, it just is not here. Distinct
          // from a search that matched nothing, which is what the message below actually means.
          <OfflineNotCached compact what={t('offline.dataCatalog')} />
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">{t('estimate.catalogEmptyResult')}</p>
        ) : (
          branches.map((branch) => (
            <TradeBranchNode
              key={branch.key}
              branch={branch}
              showTrade={showTrades}
              open={isOpen(tradeOpenKey(branch), autoOpenTrade)}
              onToggle={searching ? undefined : () => toggleOpen(tradeOpenKey(branch), autoOpenTrade)}
              isCategoryOpen={(category, fallback) =>
                isOpen(categoryOpenKey(branch, category), fallback)
              }
              onToggleCategory={
                searching
                  ? undefined
                  : (category, fallback) => toggleOpen(categoryOpenKey(branch, category), fallback)
              }
              selected={selected}
              blocked={blocked}
              single={single}
              busy={busy}
              onRow={(item) => (single ? void run([item], false) : toggle(item.id))}
            />
          ))
        )}
      </div>

      {!single && selected.size > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          {hint != null && <p className="mb-2 text-center text-xs text-muted">{hint}</p>}
          <Button fullWidth loading={busy} onClick={() => void addSelected()}>
            {t('estimate.addNItems', { count: selected.size })}
          </Button>
        </div>
      )}
    </div>
  );
}

// Open state is keyed per LEVEL and per BRANCH: the same category name legitimately exists under
// two trades («Підготовка» is a phase in most of them), and one shared key would open and close
// both folders together.
const tradeOpenKey = (branch: TradeBranch) => `t:${branch.key}`;
const categoryOpenKey = (branch: TradeBranch, category: string) => `c:${branch.key}|${category}`;

/** One trade and its folders. With a single branch the trade header is not drawn at all. */
function TradeBranchNode({
  branch,
  showTrade,
  open,
  onToggle,
  isCategoryOpen,
  onToggleCategory,
  selected,
  blocked,
  single,
  busy,
  onRow,
}: {
  branch: TradeBranch;
  showTrade: boolean;
  open: boolean;
  /** Absent while searching — every level stays open, see the picker's doc. */
  onToggle?: () => void;
  isCategoryOpen: (category: string, fallback: boolean) => boolean;
  onToggleCategory?: (category: string, fallback: boolean) => void;
  selected: ReadonlySet<string>;
  blocked: ReadonlySet<string>;
  single?: boolean;
  busy: boolean;
  onRow: (item: CatalogItemResponse) => void;
}) {
  const { t } = useTranslation();
  const custom = parseCustomTradeKey(branch.key) !== null;
  // A custom trade with no name left is still a real branch — it reads OTHER underneath (V91),
  // which is the honest label for it.
  const label = custom
    ? (branch.customName?.trim() ?? '') || t('trades.OTHER')
    : t('trades.' + branch.key);
  const picked = branch.sections.reduce(
    (n, s) => n + s.items.filter((i) => selected.has(i.id)).length,
    0,
  );
  // Inside ONE trade the old rule still applies: a short trade opens its folders, a long one
  // shows them closed.
  const autoOpenCategory = branch.sections.length <= 1 || branch.count <= AUTO_EXPAND_MAX_ITEMS;

  const folders = (
    <div
      className={cn(
        'space-y-2',
        // A thin rail, not an indent: at 375px every level of padding is width the position name
        // loses, and the name is the thing being read.
        showTrade && 'mt-1.5 border-l-2 border-brand-soft pl-2',
      )}
    >
      {branch.sections.map((section) => (
        <CategoryFolder
          key={section.category}
          category={section.category}
          items={section.items}
          open={isCategoryOpen(section.category, autoOpenCategory)}
          onToggle={
            onToggleCategory
              ? () => onToggleCategory(section.category, autoOpenCategory)
              : undefined
          }
          selected={selected}
          blocked={blocked}
          single={single}
          busy={busy}
          onRow={onRow}
        />
      ))}
    </div>
  );

  if (!showTrade) return folders;

  return (
    <section>
      <button
        type="button"
        data-testid="catalog-trade"
        onClick={onToggle}
        disabled={onToggle == null}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 rounded-xl bg-brand-soft px-3.5 py-2.5 text-left"
      >
        {onToggle && (
          <span
            aria-hidden
            className={cn('text-[10px] text-muted transition-transform', open && 'rotate-90')}
          >
            ▶
          </span>
        )}
        <span aria-hidden>{custom ? CUSTOM_TRADE_EMOJI : TRADE_EMOJI[branch.key as Trade]}</span>
        <span className="min-w-0 flex-1 break-words text-sm font-bold text-primary">{label}</span>
        {picked > 0 && (
          <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-white">
            {picked}
          </span>
        )}
        <span className="text-xs font-semibold text-muted">{branch.count}</span>
      </button>
      {open && folders}
    </section>
  );
}

/** One category and the positions filed under it. Closed, it is a single row naming what is inside. */
function CategoryFolder({
  category,
  items,
  open,
  onToggle,
  selected,
  blocked,
  single,
  busy,
  onRow,
}: {
  category: string;
  items: CatalogItemResponse[];
  open: boolean;
  /** Absent while searching — the header stays as a label, see the picker's doc. */
  onToggle?: () => void;
  selected: ReadonlySet<string>;
  blocked: ReadonlySet<string>;
  single?: boolean;
  busy: boolean;
  onRow: (item: CatalogItemResponse) => void;
}) {
  const { t } = useTranslation();
  const name = category === '' ? t('catalog.noCategory') : category;
  const picked = items.filter((i) => selected.has(i.id)).length;

  const header = (
    <>
      {onToggle && (
        <span
          aria-hidden
          className={cn('text-[10px] text-muted transition-transform', open && 'rotate-90')}
        >
          ▶
        </span>
      )}
      <span className="min-w-0 flex-1 break-words text-sm font-semibold text-primary">{name}</span>
      {/* A closed folder must still say it holds picks, or the basket count reads as a bug. */}
      {picked > 0 && (
        <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-white">
          {picked}
        </span>
      )}
      <span className="text-xs font-semibold text-muted">{items.length}</span>
    </>
  );

  const headerClass =
    'flex min-h-11 w-full items-center gap-2 rounded-xl bg-surface-sunken px-3.5 py-2.5 text-left';

  return (
    <section>
      {onToggle ? (
        <button
          type="button"
          data-testid="catalog-category"
          onClick={onToggle}
          aria-expanded={open}
          className={headerClass}
        >
          {header}
        </button>
      ) : (
        <div data-testid="catalog-category" className={headerClass}>
          {header}
        </div>
      )}

      {open && (
        <div className="mt-1.5 space-y-1.5">
          {items.map((item) => (
            <CatalogRow
              key={item.id}
              item={item}
              checked={selected.has(item.id)}
              disabled={blocked.has(item.name.trim().toLowerCase()) || (single === true && busy)}
              single={single}
              onClick={() => onRow(item)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * One position. The row is the tap target; the (i) sits BESIDE it, not inside — a button inside a
 * button is invalid markup, and the description has to be readable without picking anything.
 */
function CatalogRow({
  item,
  checked,
  disabled,
  single,
  onClick,
}: {
  item: CatalogItemResponse;
  checked: boolean;
  disabled: boolean;
  single?: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const description = item.description?.trim();

  return (
    <div className="flex items-stretch gap-1">
      <button
        type="button"
        data-testid="catalog-row"
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors',
          disabled
            ? 'cursor-not-allowed border-border bg-surface-sunken opacity-50'
            : checked
              ? 'border-brand bg-brand-soft'
              : 'border-border bg-surface',
        )}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {single !== true && (
            <span
              className={cn(
                'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border text-xs',
                checked ? 'border-brand bg-brand text-white' : 'border-border text-transparent',
              )}
            >
              ✓
            </span>
          )}
          <span className="min-w-0">
            <span className="block break-words text-sm font-medium text-primary">{item.name}</span>
            {/* One clamped line: enough to tell Q3 from Q3+ at a glance; the (i) holds the rest. */}
            {description != null && description !== '' && (
              <span className="block truncate text-[11px] leading-tight text-muted">
                {description}
              </span>
            )}
            <span className="block text-xs text-muted">
              {t('unitPer', { unit: t('units.' + item.unit) })}
            </span>
          </span>
        </span>
        <span className="whitespace-nowrap text-sm font-semibold text-primary">
          {formatMoney(item.defaultPrice)}
        </span>
      </button>
      {description != null && description !== '' && (
        <span className="flex flex-shrink-0 items-center pl-0.5">
          <InfoPopover text={description} label={item.name} />
        </span>
      )}
    </div>
  );
}
