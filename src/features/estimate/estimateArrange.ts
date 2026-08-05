/**
 * The minimum a row needs for any of this to work.
 *
 * Both the estimate board and the master's own catalog satisfy it, which is why the arithmetic
 * below is written once rather than copied: a catalog group and an estimate section are the same
 * idea — a run of rows sharing a category, ordered by the first of them.
 */
export interface Arrangeable {
  id: string;
  category: string | null;
  sortOrder: number;
}

/**
 * The arithmetic behind dragging rows around, kept out of the drag wiring so it can be tested for
 * what it is: list surgery. The components only translate pointer events into calls on these.
 *
 * A SECTION is the run of rows sharing a category — there is no such row anywhere, on the client or
 * the server. Section order follows the first row in each, which is why moving a whole section is
 * just moving its rows together, and why {@link flatten} is all the API ever needs.
 *
 * Sections are keyed on the RAW category (empty string for none), never on the «Без категорії» label
 * the screen shows. Round-tripping through the label would silently turn a category a master
 * actually named «Без категорії» into no category at all.
 */
export interface Section<T extends Arrangeable = Arrangeable> {
  /** Raw category; `''` means the row carries none. */
  category: string;
  items: T[];
}

/** Group rows into sections, in the order `sortOrder` puts them. */
export function toSections<T extends Arrangeable>(items: T[]): Section<T>[] {
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  const sections: Section<T>[] = [];
  const byCategory = new Map<string, Section<T>>();
  for (const item of sorted) {
    const category = item.category?.trim() ?? '';
    let section = byCategory.get(category);
    if (!section) {
      section = { category, items: [] };
      byCategory.set(category, section);
      sections.push(section);
    }
    section.items.push(item);
  }
  return sections;
}

/**
 * Back to the flat list the reorder request takes: position is the index, and each row carries the
 * category of the section it now sits in — so a row dragged across sections is re-categorised by
 * the same operation that repositions it.
 */
export function flatten<T extends Arrangeable>(sections: Section<T>[]): T[] {
  return sections.flatMap((s) =>
    s.items.map((item) => ({ ...item, category: s.category === '' ? null : s.category })));
}

/**
 * Move a row inside its own section.
 *
 * Returns the SAME array when the drop changes nothing — a row released where it was picked up must
 * not read as an edit, or every stray tap on the grip would fire a reorder request.
 */
export function reorderWithin<T extends Arrangeable>(
  sections: Section<T>[], category: string, fromIndex: number, toIndex: number,
): Section<T>[] {
  const target = sections.find((s) => s.category === category);
  if (!target) return sections;
  const moved = move(target.items, fromIndex, toIndex);
  if (moved === target.items) return sections;
  return sections.map((s) => (s === target ? { ...s, items: moved } : s));
}

/**
 * Move a row into another section, at `toIndex` (append when it is past the end).
 *
 * A section left with no rows disappears — it was never anything but its rows. Keeping an empty one
 * would show the master a heading they cannot delete and the server has no way to remember.
 */
export function moveToSection<T extends Arrangeable>(
  sections: Section<T>[], itemId: string, toCategory: string, toIndex: number,
): Section<T>[] {
  const item = sections.flatMap((s) => s.items).find((i) => i.id === itemId);
  if (!item) return sections;

  const stripped = sections
    .map((s) => ({ ...s, items: s.items.filter((i) => i.id !== itemId) }))
    .filter((s) => s.items.length > 0 || s.category === toCategory);

  const target = stripped.find((s) => s.category === toCategory);
  if (!target) {
    // Dropped into a section that only existed because the row was in it — nothing to do.
    return sections;
  }
  const at = Math.max(0, Math.min(toIndex, target.items.length));
  return stripped.map((s) => (s === target
    ? { ...s, items: [...s.items.slice(0, at), item, ...s.items.slice(at)] }
    : s));
}

/** Move a whole section, with everything in it, to another place in the list. */
export function reorderSections<T extends Arrangeable>(
  sections: Section<T>[], fromIndex: number, toIndex: number,
): Section<T>[] {
  return move(sections, fromIndex, toIndex);
}

/** Which section a row currently sits in, or null if it is gone. */
export function sectionOf<T extends Arrangeable>(
  sections: Section<T>[], itemId: string,
): Section<T> | null {
  return sections.find((s) => s.items.some((i) => i.id === itemId)) ?? null;
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}

// =================================================================================================
// What a drag MEANT. Separated from the dnd wiring so the decision — apply, ask first, or ignore —
// is testable without simulating pointer events, which jsdom cannot do meaningfully anyway (no
// layout, so no collision detection). The component only translates this into a call or a dialog.
// =================================================================================================

/** dnd-kit needs one id space; the prefix says which kind of thing is being dragged. */
export const SECTION_ID = 'sec:';
export const ITEM_ID = 'item:';
export const sectionId = (s: { category: string }) => SECTION_ID + s.category;

export type DragOutcome<T extends Arrangeable = Arrangeable> =
  /** Nothing moved, or the drag made no sense — do not touch the list. */
  | { kind: 'none' }
  /** Apply straight away: order changed, nothing was re-categorised. */
  | { kind: 'apply'; sections: Section<T>[] }
  /**
   * Ask first. A row landed in another section, which changes its category — and a drag is easy to
   * start by accident, so this must not happen silently on a document a client will be quoted from.
   */
  | { kind: 'confirm'; sections: Section<T>[]; from: string; to: string };

export function resolveDrag<T extends Arrangeable>(
  sections: Section<T>[], activeId: string, overId: string | null,
): DragOutcome<T> {
  if (!overId || activeId === overId) return { kind: 'none' };

  if (activeId.startsWith(SECTION_ID)) {
    const from = sections.findIndex((s) => sectionId(s) === activeId);
    // The drop usually lands on a ROW, not on a heading. A section's droppable area is its whole
    // block — heading plus every row in it — so while dragging one, whatever is under the pointer
    // is somebody's row the overwhelming majority of the time. Discarding that as "not a section"
    // is what made moving a category look like it randomly did nothing: the drag ran, the release
    // resolved to no target, and the list snapped back. A row identifies its section perfectly
    // well, so resolve through it.
    const to = overId.startsWith(SECTION_ID)
      ? sections.findIndex((s) => sectionId(s) === overId)
      : sections.findIndex((s) => s.items.some((i) => ITEM_ID + i.id === overId));
    if (from < 0 || to < 0) return { kind: 'none' };
    const next = reorderSections(sections, from, to);
    return next === sections ? { kind: 'none' } : { kind: 'apply', sections: next };
  }

  const itemId = activeId.slice(ITEM_ID.length);
  const source = sectionOf(sections, itemId);
  if (!source) return { kind: 'none' };

  const overIsSection = overId.startsWith(SECTION_ID);
  const overItemId = overIsSection ? null : overId.slice(ITEM_ID.length);
  const target = overIsSection
    ? sections.find((s) => sectionId(s) === overId)
    : sectionOf(sections, overItemId!);
  if (!target) return { kind: 'none' };

  if (target === source) {
    const from = source.items.findIndex((i) => i.id === itemId);
    const to = source.items.findIndex((i) => i.id === overItemId);
    if (to < 0) return { kind: 'none' };
    const next = reorderWithin(sections, source.category, from, to);
    return next === sections ? { kind: 'none' } : { kind: 'apply', sections: next };
  }

  const at = overIsSection
    ? target.items.length
    : target.items.findIndex((i) => i.id === overItemId);
  const next = moveToSection(sections, itemId, target.category, at);
  return next === sections
    ? { kind: 'none' }
    : { kind: 'confirm', sections: next, from: source.category, to: target.category };
}
