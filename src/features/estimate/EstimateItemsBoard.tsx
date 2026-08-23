import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, closestCorners, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { DragGrip } from '@/components/DragGrip.tsx';
import { formatMoney, formatNumber } from '@/lib/format.ts';
import { cn } from '@/lib/cn.ts';
import { percentLabel } from './percentLine.ts';
import type { EstimateItemResponse } from '@/api/types.ts';
import {
  flatten, ITEM_ID, resolveDrag, SECTION_ID, sectionId, toSections, type Section,
} from './estimateArrange.ts';

/**
 * Which droppable a drag is over.
 *
 * Dragging a SECTION only ever considers other sections, and by corners rather than centres. Both
 * halves matter. With every line also a candidate, the nearest thing to a moving category was
 * almost always a line — lines are small and there are dozens of them, while a section's centre
 * sits buried in the middle of its own block. And with `closestCenter` between blocks of wildly
 * different heights, a short category had to be dragged past the MIDDLE of a thirty-line one before
 * it would give way, which is the "то тягнеться, то не тягнеться". Corners react at the edge.
 *
 * Dragging a line is left alone: a line is dropped on another line, and that already worked.
 */
const collisionDetection: CollisionDetection = (args) => {
  if (!String(args.active.id).startsWith(SECTION_ID)) return closestCenter(args);
  return closestCorners({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) => String(c.id).startsWith(SECTION_ID)),
  });
};

/**
 * The estimate's lines, grouped into sections and rearrangeable by dragging.
 *
 * <p>Three moves: a line inside its section, a line into ANOTHER section (which changes its category,
 * so it asks first), and a whole section with everything in it.</p>
 *
 * Dragging is on a dedicated grip, never the row. The row is a button that opens the line for editing,
 * and making the whole thing draggable would turn every tap into a coin flip between editing and
 * moving — on a phone, with a hand in a work glove, that is not a trade worth making.
 *
 * Sections are not stored anywhere: a section IS the lines sharing a category, ordered by the first of
 * them. So moving a section is moving its lines together, and the whole feature reduces to one
 * renumbering — see estimateArrange.
 */
export function EstimateItemsBoard({
  items,
  signed,
  touched,
  lastTouched,
  onEdit,
  onArrange,
  selection,
}: {
  items: EstimateItemResponse[];
  /** A signed estimate is read-only: no grips, no drags. */
  signed: boolean;
  /** Ids added/edited this session — faintly highlighted so a change isn't lost in a long list. */
  touched?: ReadonlySet<string>;
  /** Ids from the MOST RECENT add/edit — a step brighter than the rest of `touched`, so the master
   *  can see at a glance which line he last worked on while stepping through a long estimate. */
  lastTouched?: ReadonlySet<string>;
  onEdit: (item: EstimateItemResponse) => void;
  /** The new arrangement, flat and in order, each line carrying the section it now belongs to. */
  onArrange: (arranged: EstimateItemResponse[]) => void;
  /**
   * Selection mode, when the master is picking lines to delete or to mark up.
   *
   * Absent = the ordinary board. Present, it takes over the row's tap: dragging and editing are
   * both out of the way, because a tap that might mean three different things is worse than three
   * modes that each mean one.
   */
  selection?: {
    selected: Set<string>;
    onToggle: (id: string) => void;
    /** Tick or clear a whole category at once — see the note where it is rendered. */
    onToggleSection: (ids: string[], select: boolean) => void;
  };
}) {
  const { t } = useTranslation();
  // Built once per render: a percentage row names the line it is measured against.
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  // Split by TYPE first, like the PDF's РОБОТИ / МАТЕРІАЛИ sections. Each type gets its OWN
  // DndContext below, which is what makes the works↔materials boundary impossible to cross by
  // dragging: a drag started in one context can only ever drop on that context's droppables, so a
  // line's type can never change by a drag, and a whole category can't jump the divide either.
  const works = useMemo(() => items.filter((i) => i.type === 'WORK'), [items]);
  const materials = useMemo(() => items.filter((i) => i.type === 'MATERIAL'), [items]);
  const worksSections = useMemo(() => toSections(works), [works]);
  const materialsSections = useMemo(() => toSections(materials), [materials]);
  /** A cross-category move waiting on the master's yes — see the dialog at the bottom. */
  const [pending, setPending] = useState<{ arranged: EstimateItemResponse[]; from: string; to: string } | null>(null);

  // The saved order is always works-first: dragging within a type reorders that type, the other is
  // carried through untouched, and the flat result mirrors the PDF (all works, then all materials).
  const combine = (type: 'WORK' | 'MATERIAL', next: Section<EstimateItemResponse>[]) =>
    type === 'WORK'
      ? [...flatten(next), ...flatten(materialsSections)]
      : [...flatten(worksSections), ...flatten(next)];

  const onDragEndFor = (type: 'WORK' | 'MATERIAL', sections: Section<EstimateItemResponse>[]) =>
    ({ active, over }: DragEndEvent) => {
      const outcome = resolveDrag(sections, String(active.id), over ? String(over.id) : null);
      if (outcome.kind === 'apply') {
        onArrange(combine(type, outcome.sections));
      } else if (outcome.kind === 'confirm') {
        setPending({
          arranged: combine(type, outcome.sections),
          from: label(outcome.from, t),
          to: label(outcome.to, t),
        });
      }
    };

  // Headings only when the estimate actually has both — a works-only sheet (the common case, the
  // catalog is works-only) reads exactly as before, no «РОБОТИ» banner over a single block.
  const bothTypes = works.length > 0 && materials.length > 0;

  return (
    <>
      {works.length > 0 && (
        <TypeGroup
          heading={bothTypes ? t('estimate.works') : null}
          sections={worksSections}
          startNumber={1}
          signed={signed}
          touched={touched}
          lastTouched={lastTouched}
          onEdit={onEdit}
          selection={selection}
          byId={byId}
          onDragEnd={onDragEndFor('WORK', worksSections)}
        />
      )}
      {materials.length > 0 && (
        <TypeGroup
          heading={bothTypes ? t('estimate.materials') : null}
          sections={materialsSections}
          startNumber={works.length + 1}
          signed={signed}
          touched={touched}
          lastTouched={lastTouched}
          onEdit={onEdit}
          selection={selection}
          byId={byId}
          onDragEnd={onDragEndFor('MATERIAL', materialsSections)}
        />
      )}

      <ConfirmDialog
        open={pending !== null}
        title={t('estimate.moveSectionTitle')}
        message={t('estimate.moveSectionMessage', { from: pending?.from, to: pending?.to })}
        confirmLabel={t('estimate.moveSectionConfirm')}
        onConfirm={() => {
          if (pending) onArrange(pending.arranged);
          setPending(null);
        }}
        onClose={() => setPending(null)}
      />
    </>
  );
}

/**
 * One type's block: the РОБОТИ / МАТЕРІАЛИ heading (with its subtotal), then that type's category
 * sections inside their OWN DndContext. The separate context is the whole point — it fences dragging
 * to this type, so a line or a category can never cross into the other.
 */
function TypeGroup({
  heading, sections, startNumber, signed, touched, lastTouched, onEdit, selection, byId, onDragEnd,
}: {
  /** The section heading, or null to render the block bare (a single-type estimate). */
  heading: string | null;
  sections: Section<EstimateItemResponse>[];
  /** Position number of this group's first line, so numbering runs 1..N across both groups. */
  startNumber: number;
  signed: boolean;
  touched?: ReadonlySet<string>;
  lastTouched?: ReadonlySet<string>;
  onEdit: (item: EstimateItemResponse) => void;
  selection?: Selection;
  byId: Map<string, EstimateItemResponse>;
  onDragEnd: (e: DragEndEvent) => void;
}) {
  const sensors = useSensors(
    // 8px before a drag begins: a tap on the grip still registers as a tap, and a swipe to scroll
    // is not stolen. The grip also sets touch-action:none so the browser does not scroll instead.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const subtotal = sections.reduce((sum, s) => sum + s.items.reduce((n, i) => n + i.lineTotal, 0), 0);

  return (
    <div className="mb-2">
      {heading && (
        <div className="mb-2 mt-1 flex items-center justify-between border-b border-border pb-1.5">
          <span className="text-sm font-extrabold uppercase tracking-wide text-primary">{heading}</span>
          <span className="text-sm font-bold text-muted">{formatMoney(subtotal)}</span>
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={sections.map(sectionId)} strategy={verticalListSortingStrategy}>
          {/* The running number is continued from startNumber, across sections AND across the two
              groups, so the last number on screen is still the estimate's position count. */}
          {sections.map((section, s) => (
            <SectionBlock
              key={sectionId(section)}
              section={section}
              firstNumber={sections.slice(0, s).reduce((n, prev) => n + prev.items.length, startNumber)}
              signed={signed}
              touched={touched}
              lastTouched={lastTouched}
              onEdit={onEdit}
              selection={selection}
              byId={byId}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

function label(category: string, t: (k: string) => string): string {
  return category === '' ? t('catalog.noCategory') : category;
}

interface Selection {
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleSection: (ids: string[], select: boolean) => void;
}

/** The tick itself. `aria-hidden` — the pressed state is announced by the button that owns it. */
function Tick({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-5 w-5 items-center justify-center rounded border text-[11px] font-bold ${
        on ? 'border-brand bg-brand text-white' : 'border-border text-transparent'
      }`}
    >
      ✓
    </span>
  );
}

function SectionBlock({
  section, firstNumber, signed, touched, lastTouched, onEdit, selection, byId,
}: {
  section: Section<EstimateItemResponse>;
  byId: Map<string, EstimateItemResponse>;
  /** Position number of this section's first line, counted from the top of the whole estimate. */
  firstNumber: number;
  signed: boolean;
  touched?: ReadonlySet<string>;
  lastTouched?: ReadonlySet<string>;
  onEdit: (item: EstimateItemResponse) => void;
  selection?: Selection;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sectionId(section),
    disabled: signed || !!selection,
  });
  const ids = section.items.map((i) => i.id);
  const allPicked = selection ? ids.every((id) => selection.selected.has(id)) : false;
  // What this stage costs. The master is asked it on site far more often than the grand total.
  const subtotal = section.items.reduce((sum, i) => sum + i.lineTotal, 0);

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`mb-4 rounded-xl ${isDragging ? 'bg-brand-soft/40 opacity-90 shadow-lg' : ''}`}
    >
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-brand">
        {/* The category checkbox is what makes this feature worth building. A master who applies a
            167-position catalog keeps one trade's worth and drops the rest — he is not picking
            scattered lines, he is dropping whole categories. Ticking «Басейни» turns thirty taps
            into one, and it is the difference between a usable big template and an unusable one. */}
        {selection ? (
          <button
            type="button"
            onClick={() => selection.onToggleSection(ids, !allPicked)}
            aria-pressed={allPicked}
            aria-label={t('estimate.selectSection', { name: label(section.category, t) })}
            className="flex h-11 w-7 flex-shrink-0 items-center justify-center"
          >
            <Tick on={allPicked} />
          </button>
        ) : (
          !signed && <DragGrip listeners={listeners} attributes={attributes} label={t('estimate.dragSection')} />
        )}
        <span className="h-1.5 w-1.5 rounded-full bg-brand" />
        <span className="min-w-0 flex-1 truncate">{label(section.category, t)}</span>
        <span className="font-bold normal-case text-muted">{formatMoney(subtotal)}</span>
      </div>

      <div className="space-y-1.5">
        <SortableContext
          items={section.items.map((i) => ITEM_ID + i.id)}
          strategy={verticalListSortingStrategy}
        >
          {section.items.map((item, i) => (
            <ItemRow
              key={item.id}
              item={item}
              number={firstNumber + i}
              signed={signed}
              touched={touched}
              lastTouched={lastTouched}
              onEdit={onEdit}
              selection={selection}
              byId={byId}
            />
          ))}
        </SortableContext>
      </div>
    </section>
  );
}

function ItemRow({
  item, number, signed, touched, lastTouched, onEdit, selection, byId,
}: {
  item: EstimateItemResponse;
  /** Every line by id, so a percentage row can name the line it is measured against. */
  byId: Map<string, EstimateItemResponse>;
  number: number;
  signed: boolean;
  touched?: ReadonlySet<string>;
  lastTouched?: ReadonlySet<string>;
  onEdit: (item: EstimateItemResponse) => void;
  selection?: Selection;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ITEM_ID + item.id,
    disabled: signed || !!selection,
  });
  const picked = selection ? selection.selected.has(item.id) : false;
  // Just-edited gets the brighter (success) highlight; touched-earlier-this-session keeps the
  // fainter brand one; neither applies while the selection state owns the row's look.
  const isLastTouched = !picked && (lastTouched?.has(item.id) ?? false);
  const isTouched = !picked && !isLastTouched && (touched?.has(item.id) ?? false);
  // Closed by SIGNED acts (acts iteration). The MEANING is always carried by the chip, never by
  // colour alone — that keeps it distinct from the transient (chip-less) last-touched highlight,
  // which also uses success, and keeps it accessible. A DRAFT act contributes nothing (the backend
  // only counts SIGNED into closedByActs), so this never shows work the client hasn't accepted.
  const closed = item.closedByActs ?? 0;
  const fullyClosed = closed > 0 && closed >= item.quantity;
  const partlyClosed = closed > 0 && !fullyClosed;

  // `data-item-id` is the anchor the editor scrolls a just-added/edited line to. Rows are nested
  // inside category sections, so the page cannot hold a ref per line — it finds this by id instead.
  return (
    <div
      ref={setNodeRef}
      data-item-id={item.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`flex items-stretch gap-1 ${isDragging ? 'z-10 opacity-90' : ''}`}
    >
      {selection ? (
        // A BUTTON, not a span. It was inert, and a checkbox that does nothing when you tap it is
        // worse than no checkbox: the card beside it was the only target, so the feature read as
        // "only whole categories can be picked". Both halves of the row toggle now.
        <button
          type="button"
          onClick={() => selection.onToggle(item.id)}
          aria-pressed={picked}
          aria-label={item.name}
          className="flex w-7 flex-shrink-0 items-center justify-center"
        >
          <Tick on={picked} />
        </button>
      ) : (
        !signed && (
          <DragGrip listeners={listeners} attributes={attributes} label={t('estimate.dragItem')} stretch />
        )
      )}
      <button
        type="button"
        // In selection mode the row IS the checkbox — the whole card, not a 20 px square, because
        // this is a thumb picking dozens of lines in a row.
        onClick={() => (selection ? selection.onToggle(item.id) : !signed && onEdit(item))}
        disabled={signed && !selection}
        aria-pressed={selection ? picked : undefined}
        title={signed && !selection ? t('estimate.signedNoEdit') : undefined}
        className={cn(
          'flex min-w-0 flex-1 gap-1.5 rounded-xl border px-3 py-3 text-left transition disabled:cursor-default active:scale-[0.99] disabled:active:scale-100',
          picked ? 'border-brand bg-brand-soft/40'
            : isLastTouched ? 'border-success/50 bg-success-soft'
              : isTouched ? 'border-brand/30 bg-brand-soft/20'
                : fullyClosed ? 'border-success/60 bg-success-soft'
                  : partlyClosed ? 'border-success/40 bg-success-soft/40'
                    : 'border-border bg-surface',
        )}
      >
        {/* The number is a GUTTER for the whole card, not a word inside the name.
            Putting it in the name's text flow was the first attempt and it read as a mess: a name
            long enough to wrap — most of them, on a phone — sent its second line back to the left
            margin, underneath the number, so neither the text nor the column lined up with
            anything. As its own column it stays a column, and every line of the name shares one
            left edge.

            MIN-width, not a fixed one, and sized for two digits. Reserving three digits' worth on
            every row bought alignment for the rare 100+ estimate by taking a strip of a 375 px
            screen away from every ordinary one — the wrong trade, since the name is what the master
            reads and the number is only a reference mark. A three-digit row simply grows by a
            couple of pixels. Tabular figures keep the right edge straight, which is what lets him
            run a finger down the column and count. */}
        {/* self-center, not top-aligned: a name wraps to two or three lines on a phone, and a
            number pinned to the first line reads as if it belongs to that line rather than to the
            row. Centred on the row's height it belongs to the whole card. */}
        <span className="min-w-[1.35rem] flex-shrink-0 pt-[3px] text-right text-[13px] tabular-nums text-faint">
          {number}.
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0 flex-1 text-sm font-medium text-primary">{item.name}</span>
            <span className="whitespace-nowrap text-sm font-bold text-primary">
              {formatMoney(item.lineTotal)}
            </span>
          </span>
          {/* No manual indent any more: the gutter above already holds the column open, so this
              line simply starts where the name starts. */}
          <span className="mt-1 flex items-center gap-2 text-xs text-muted">
            <span>
              {formatNumber(item.quantity, 3)} {t('units.' + item.unit)}
            </span>
            <span className="h-[3px] w-[3px] rounded-full bg-faint" />
            {/* A percentage has no price per unit — «500 ₴/%» meant nothing. It says what it is a
                percentage OF, in the same words the PDF and the client's portal use. */}
            <span className={cn(item.baseDetached && 'text-amber')}>
              {percentLabel(item, byId) ?? `${formatMoney(item.unitPrice)}/${t('units.' + item.unit)}`}
            </span>
            {fullyClosed && (
              <span className="ml-auto flex-shrink-0 whitespace-nowrap rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
                {t('acts.closedFull')}
              </span>
            )}
            {partlyClosed && (
              <span className="ml-auto flex-shrink-0 whitespace-nowrap rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                {formatNumber(closed, 3)} / {formatNumber(item.quantity, 3)}
              </span>
            )}
          </span>
        </span>
      </button>
    </div>
  );
}
