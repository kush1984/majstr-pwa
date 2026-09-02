import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@/lib/format.ts';
import { cn } from '@/lib/cn.ts';
import { InfoPopover } from '@/components/InfoPopover.tsx';
import type { CatalogItemResponse } from '@/api/types.ts';
import { sectionId, toSections, type Section } from '@/features/estimate/estimateArrange.ts';
import { catalogSectionRank } from './sharedCategory.ts';

/**
 * The master's own catalog, grouped into categories. A row tap opens the position for editing; in
 * selection mode a tap ticks it instead (whole categories tick from their header).
 *
 * <p>Folders come out in the order the work is done in ({@link catalogSectionRank}); inside a
 * folder, positions are shown in the order the backend returns them. There is no manual
 * drag-reordering here — a catalog is a reference list a master searches and prices, not one he
 * arranges, and the grips only added weight to every row.</p>
 */
export interface CatalogSelection {
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleSection: (ids: string[], select: boolean) => void;
}

export function CatalogBoard({
  items,
  onEdit,
  selection,
}: {
  items: CatalogItemResponse[];
  onEdit: (item: CatalogItemResponse) => void;
  /** Selection mode — present, it takes over the row's tap; editing steps aside. */
  selection?: CatalogSelection;
}) {
  const sections = useMemo(() => toSections(items, catalogSectionRank), [items]);

  return (
    <>
      {sections.map((section) => (
        <CategoryBlock
          key={sectionId(section)}
          section={section}
          onEdit={onEdit}
          selection={selection}
        />
      ))}
    </>
  );
}

function label(category: string, t: (k: string) => string): string {
  return category === '' ? t('catalog.noCategory') : category;
}

/** The tick itself. `aria-hidden` — the pressed state is announced by the button that owns it. */
function Tick({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-5 w-5 items-center justify-center rounded border text-[11px] font-bold',
        on ? 'border-brand bg-brand text-white' : 'border-border text-transparent',
      )}
    >
      ✓
    </span>
  );
}

function CategoryBlock({
  section, onEdit, selection,
}: {
  section: Section<CatalogItemResponse>;
  onEdit: (item: CatalogItemResponse) => void;
  selection?: CatalogSelection;
}) {
  const { t } = useTranslation();
  const ids = section.items.map((i) => i.id);
  const allPicked = selection ? ids.every((id) => selection.selected.has(id)) : false;

  return (
    <section className="mb-5 rounded-xl">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-brand">
        {/* Ticking a whole category is the point of selection here even more than in an estimate:
            a master dropping a trade he does not do is removing a hundred rows, not five. */}
        {selection && (
          <button
            type="button"
            onClick={() => selection.onToggleSection(ids, !allPicked)}
            aria-pressed={allPicked}
            aria-label={t('catalog.selectCategory', { name: label(section.category, t) })}
            className="flex h-11 w-7 flex-shrink-0 items-center justify-center"
          >
            <Tick on={allPicked} />
          </button>
        )}
        <span className="h-1.5 w-1.5 rounded-full bg-brand" />
        <span className="min-w-0 flex-1 break-words">{label(section.category, t)}</span>
        <span className="font-bold normal-case text-muted">· {section.items.length}</span>
      </div>

      <div className="space-y-1.5">
        {section.items.map((item) => (
          <ItemRow key={item.id} item={item} onEdit={onEdit} selection={selection} />
        ))}
      </div>
    </section>
  );
}

function ItemRow({
  item, onEdit, selection,
}: {
  item: CatalogItemResponse;
  onEdit: (item: CatalogItemResponse) => void;
  selection?: CatalogSelection;
}) {
  const { t } = useTranslation();
  const picked = selection ? selection.selected.has(item.id) : false;
  const description = item.description?.trim();

  return (
    <div className="flex items-stretch gap-1">
      {selection && (
        <button
          type="button"
          onClick={() => selection.onToggle(item.id)}
          aria-pressed={picked}
          aria-label={item.name}
          className="flex w-7 flex-shrink-0 items-center justify-center"
        >
          <Tick on={picked} />
        </button>
      )}
      <button
        type="button"
        onClick={() => (selection ? selection.onToggle(item.id) : onEdit(item))}
        aria-pressed={selection ? picked : undefined}
        className={cn(
          'flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl border bg-surface px-3.5 py-3 text-left transition-transform active:scale-[0.99]',
          picked ? 'border-brand bg-brand-soft/40' : 'border-border',
        )}
      >
        <span className="min-w-0 flex-1">
          {/* Wraps instead of truncating: catalog names are long and specific, and the tail is
              exactly what tells two positions apart. */}
          <span className="block break-words text-sm font-medium text-primary">{item.name}</span>
          {/* One clamped line, same as the picker: enough to tell Q3 from Q3+ at a glance, with
              the (i) beside the row holding the rest. «не всі вкурсі таких рівнів». */}
          {description != null && description !== '' && (
            <span className="block truncate text-[11px] leading-tight text-muted">
              {description}
            </span>
          )}
          <span className="block text-xs text-muted">за {t('units.' + item.unit)}</span>
        </span>
        <span className="whitespace-nowrap text-sm font-bold text-primary">
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
