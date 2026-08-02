import { describe, expect, it } from 'vitest';
import {
  flatten, ITEM_ID, moveToSection, reorderSections, reorderWithin, resolveDrag, SECTION_ID,
  sectionOf, toSections,
} from './estimateArrange.ts';
import type { EstimateItemResponse } from '@/api/types.ts';

/**
 * The list surgery behind the drag. Tested here rather than through simulated pointer events,
 * because this is where a mistake silently reorders a master's estimate — the wiring above it only
 * decides which of these to call.
 */
function line(id: string, category: string | null, sortOrder: number): EstimateItemResponse {
  return {
    id, name: id, category, type: 'WORK', unit: 'M2',
    quantity: 1, unitPrice: 100, lineTotal: 100, sortOrder,
  } as EstimateItemResponse;
}

/** Підготовка: a, b · Плитка: c, d · (no category): e */
const items = [
  line('a', 'Підготовка', 0),
  line('b', 'Підготовка', 1),
  line('c', 'Плитка', 2),
  line('d', 'Плитка', 3),
  line('e', null, 4),
];

const ids = (sections: ReturnType<typeof toSections>) =>
  sections.map((s) => `${s.category || '-'}:${s.items.map((i) => i.id).join(',')}`);

describe('toSections', () => {
  it('groups by category in the order sortOrder puts them', () => {
    expect(ids(toSections(items))).toEqual(['Підготовка:a,b', 'Плитка:c,d', '-:e']);
  });

  it('reads the order from sortOrder, not from the array', () => {
    // The cache may hand these over in any order; sortOrder is the authority.
    const shuffled = [items[3], items[0], items[4], items[2], items[1]];
    expect(ids(toSections(shuffled))).toEqual(['Підготовка:a,b', 'Плитка:c,d', '-:e']);
  });

  it('keeps a category literally named «Без категорії» distinct from having none', () => {
    // The screen shows that label for unfiled lines, so keying sections on the LABEL would merge
    // the two and quietly strip a category the master typed themselves.
    const tricky = [line('x', 'Без категорії', 0), line('y', null, 1)];
    expect(ids(toSections(tricky))).toEqual(['Без категорії:x', '-:y']);
  });
});

describe('reorderWithin', () => {
  it('moves a line down inside its section and leaves the others alone', () => {
    const after = reorderWithin(toSections(items), 'Підготовка', 0, 1);
    expect(ids(after)).toEqual(['Підготовка:b,a', 'Плитка:c,d', '-:e']);
  });

  it('is a no-op when dropped where it started', () => {
    const before = toSections(items);
    expect(reorderWithin(before, 'Плитка', 1, 1)).toBe(before);
  });
});

describe('moveToSection', () => {
  it('inserts at the requested position and re-categorises the line', () => {
    const after = moveToSection(toSections(items), 'a', 'Плитка', 1);
    expect(ids(after)).toEqual(['Підготовка:b', 'Плитка:c,a,d', '-:e']);
    // flatten is what the request is built from — the category must travel with the line
    expect(flatten(after).find((i) => i.id === 'a')?.category).toBe('Плитка');
  });

  it('appends when dropped past the end', () => {
    const after = moveToSection(toSections(items), 'e', 'Підготовка', 99);
    expect(ids(after)).toEqual(['Підготовка:a,b,e', 'Плитка:c,d']);
  });

  it('drops a section that has just been emptied', () => {
    // A section is nothing but its lines. An empty one would be a heading the master cannot remove
    // and the server has nowhere to store.
    const after = moveToSection(toSections(items), 'e', 'Плитка', 0);
    expect(ids(after)).toEqual(['Підготовка:a,b', 'Плитка:e,c,d']);
  });

  it('moves a line into the no-category section, clearing its category', () => {
    const after = moveToSection(toSections(items), 'c', '', 0);
    expect(ids(after)).toEqual(['Підготовка:a,b', 'Плитка:d', '-:c,e']);
    expect(flatten(after).find((i) => i.id === 'c')?.category).toBeNull();
  });

  it('ignores an id that is not there', () => {
    const before = toSections(items);
    expect(moveToSection(before, 'нема', 'Плитка', 0)).toBe(before);
  });
});

describe('reorderSections', () => {
  it('moves a whole section with everything in it', () => {
    const after = reorderSections(toSections(items), 1, 0);
    expect(ids(after)).toEqual(['Плитка:c,d', 'Підготовка:a,b', '-:e']);
  });

  it('renumbers sortOrder across the whole estimate when flattened', () => {
    // Section order is not stored — it is derived from the first line of each. So moving a section
    // has to come out as a global renumbering, or the sections would snap back on reload.
    const after = flatten(reorderSections(toSections(items), 2, 0));
    expect(after.map((i) => i.id)).toEqual(['e', 'a', 'b', 'c', 'd']);
  });
});

describe('sectionOf', () => {
  it('finds the section holding a line', () => {
    expect(sectionOf(toSections(items), 'd')?.category).toBe('Плитка');
    expect(sectionOf(toSections(items), 'e')?.category).toBe('');
    expect(sectionOf(toSections(items), 'нема')).toBeNull();
  });
});

describe('resolveDrag', () => {
  const sections = toSections(items);
  const item = (id: string) => `${ITEM_ID}${id}`;
  const sec = (category: string) => `${SECTION_ID}${category}`;

  it('applies a move inside a section without asking', () => {
    const out = resolveDrag(sections, item('a'), item('b'));
    expect(out.kind).toBe('apply');
    if (out.kind !== 'apply') throw new Error('unreachable');
    expect(ids(out.sections)).toEqual(['Підготовка:b,a', 'Плитка:c,d', '-:e']);
  });

  it('applies a section move without asking', () => {
    const out = resolveDrag(sections, sec('Плитка'), sec('Підготовка'));
    expect(out.kind).toBe('apply');
    if (out.kind !== 'apply') throw new Error('unreachable');
    expect(ids(out.sections)).toEqual(['Плитка:c,d', 'Підготовка:a,b', '-:e']);
  });

  it('moves a section when the drop landed on a LINE of another section', () => {
    // The bug a master reported as "categories drag, then randomly do nothing". A section's
    // droppable area is its whole block, so on release the thing under the pointer is nearly
    // always someone's line — and treating that as "no section here" threw the whole drag away.
    const out = resolveDrag(sections, sec('Плитка'), item('a'));
    expect(out.kind).toBe('apply');
    if (out.kind !== 'apply') throw new Error('unreachable');
    expect(ids(out.sections)).toEqual(['Плитка:c,d', 'Підготовка:a,b', '-:e']);
  });

  it('does nothing when a section is dropped on one of its OWN lines', () => {
    // Same resolution path, but it must not read as a move: the section did not go anywhere, and a
    // spurious reorder request on every mis-tap of the grip is exactly what this guards.
    expect(resolveDrag(sections, sec('Плитка'), item('c')).kind).toBe('none');
  });

  it('ASKS before moving a line into another section', () => {
    // The one branch that must never apply silently: it changes the line's category, and a drag is
    // easy to start by accident on a document a client gets quoted from.
    const out = resolveDrag(sections, item('a'), item('c'));
    expect(out.kind).toBe('confirm');
    if (out.kind !== 'confirm') throw new Error('unreachable');
    expect(out.from).toBe('Підготовка');
    expect(out.to).toBe('Плитка');
    expect(ids(out.sections)).toEqual(['Підготовка:b', 'Плитка:a,c,d', '-:e']);
  });

  it('reports the raw category, so the caller can label «no category» itself', () => {
    const out = resolveDrag(sections, item('a'), item('e'));
    expect(out.kind).toBe('confirm');
    if (out.kind !== 'confirm') throw new Error('unreachable');
    expect(out.to).toBe('');   // NOT «Без категорії» — that label belongs to the UI layer
  });

  it('appends when dropped on a section header rather than on a line', () => {
    const out = resolveDrag(sections, item('e'), sec('Підготовка'));
    expect(out.kind).toBe('confirm');
    if (out.kind !== 'confirm') throw new Error('unreachable');
    expect(ids(out.sections)).toEqual(['Підготовка:a,b,e', 'Плитка:c,d']);
  });

  it('does nothing when dropped on itself, outside anything, or on an unknown id', () => {
    expect(resolveDrag(sections, item('a'), item('a')).kind).toBe('none');
    expect(resolveDrag(sections, item('a'), null).kind).toBe('none');
    expect(resolveDrag(sections, item('a'), item('нема')).kind).toBe('none');
    expect(resolveDrag(sections, item('нема'), item('b')).kind).toBe('none');
    expect(resolveDrag(sections, sec('нема'), sec('Плитка')).kind).toBe('none');
  });
});
