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
import { toSections } from '@/features/estimate/estimateArrange.ts';
import { useCatalog } from './useCatalog.ts';
import { TradeFilterChips, tradeMatches, type TradeKey } from './TradeFilterChips.tsx';
import { asSelectedTradeSees, catalogSectionRank } from './sharedCategory.ts';
import type { CatalogItemResponse, ItemType } from '@/api/types.ts';

type TypeFilter = ItemType | 'ALL';

const TYPE_FILTERS: { value: TypeFilter; labelKey: string }[] = [
  { value: 'ALL', labelKey: 'common.all' },
  { value: 'WORK', labelKey: 'catalog.filterWorks' },
  { value: 'MATERIAL', labelKey: 'catalog.filterMaterials' },
];

/**
 * At or below this many positions every category opens by default: a flat list was never the
 * problem at this size, and collapsing it would only add a tap. Above it the master gets the
 * folders first — which is the whole point («не навантажуй відразу всім»).
 */
const AUTO_EXPAND_MAX_ITEMS = 10;

/**
 * THE catalog picker. One component behind every "add a position" surface — the estimate editor,
 * the template editor (add + replace), and an act's additional works — so the screen is learned
 * once. Before it there were two near-identical copies plus a surface with no browse at all, and
 * only the copies could ever be fixed together.
 *
 * <p>Positions are grouped into their CATEGORY, collapsed, because the flat list is what a master
 * told us was unusable: «не класифіковано, не систематизовано, плоскі списки, логічна цепочка як
 * дерево програми просто відсутня». The grouping is {@link toSections} — the same function the
 * catalog page groups by, not a second copy of the arithmetic — so a category means exactly the
 * same thing on both screens, ordered by the master's own `sortOrder`.</p>
 *
 * <p><b>Trade stays a chip row, not a level of the tree.</b> A master's catalog holds only the
 * trades he works, most often one (`TradeFilterChips` hides itself under two), so a trade level
 * would be a tap that answers nothing. The volume — and the complaint — is INSIDE one trade.</p>
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
  const [tradeFilter, setTradeFilter] = useState<Set<TradeKey>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openState, setOpenState] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const blocked = useMemo(
    () => new Set((disabledNames ?? []).map((n) => n.trim().toLowerCase())),
    [disabledNames],
  );

  const searching = q.trim().length > 0;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return asSelectedTradeSees(
      (data ?? [])
        .filter((i) => typeFilter === 'ALL' || i.type === typeFilter)
        .filter((i) => tradeMatches(i, tradeFilter))
        .filter((i) => !needle || i.name.toLowerCase().includes(needle)),
      tradeFilter,
    );
  }, [data, q, typeFilter, tradeFilter]);

  const sections = useMemo(() => toSections(filtered, catalogSectionRank), [filtered]);

  const autoExpand = sections.length <= 1 || filtered.length <= AUTO_EXPAND_MAX_ITEMS;
  const isOpen = (category: string) => searching || (openState[category] ?? autoExpand);
  const toggleSection = (category: string) =>
    setOpenState((prev) => ({ ...prev, [category]: !(prev[category] ?? autoExpand) }));

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
      <TradeFilterChips items={data ?? []} value={tradeFilter} onChange={setTradeFilter} />
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
          sections.map((section) => (
            <CategoryFolder
              key={section.category}
              category={section.category}
              items={section.items}
              open={isOpen(section.category)}
              onToggle={searching ? undefined : () => toggleSection(section.category)}
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
