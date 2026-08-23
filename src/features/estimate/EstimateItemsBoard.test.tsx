import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/lib/i18n.ts';
import { EstimateItemsBoard } from './EstimateItemsBoard.tsx';
import type { EstimateItemResponse } from '@/api/types.ts';

/**
 * The board splits into РОБОТИ / МАТЕРІАЛИ groups (like the PDF) — and each type has its OWN
 * DndContext, which is what makes a drag across the works/materials boundary impossible. The drag
 * itself is untestable in jsdom (no layout → no collision detection), so what is pinned here is the
 * split: headings appear only when both types are present, and numbering runs continuously across.
 */
const line = (over: Partial<EstimateItemResponse>): EstimateItemResponse => ({
  id: 'x', type: 'WORK', name: 'Позиція', category: null, unit: 'M2',
  quantity: 1, unitPrice: 100, lineTotal: 100, sortOrder: 0,
  measurementRefs: [], quantityManual: false,
  percentBaseKind: null, percentBaseItemId: null, baseDetached: false, baseOriginLabel: null, closedByActs: null,
  ...over,
});

describe('EstimateItemsBoard — works/materials split', () => {
  it('shows РОБОТИ and МАТЕРІАЛИ headings when the estimate has both', () => {
    render(
      <EstimateItemsBoard
        items={[
          line({ id: 'w', name: 'Демонтаж', type: 'WORK', sortOrder: 0 }),
          line({ id: 'm', name: 'Плитка', type: 'MATERIAL', sortOrder: 1 }),
        ]}
        signed={false}
        onEdit={vi.fn()}
        onArrange={vi.fn()}
      />,
    );
    // The DOM text is «Роботи»/«Матеріали» (CSS uppercases it visually).
    expect(screen.getByText('Роботи')).toBeTruthy();
    expect(screen.getByText('Матеріали')).toBeTruthy();
  });

  it('shows no type headings for a works-only estimate (the common case)', () => {
    render(
      <EstimateItemsBoard
        items={[line({ id: 'w', name: 'Демонтаж', type: 'WORK', sortOrder: 0 })]}
        signed={false}
        onEdit={vi.fn()}
        onArrange={vi.fn()}
      />,
    );
    expect(screen.queryByText('Роботи')).toBeNull();
    expect(screen.queryByText('Матеріали')).toBeNull();
  });
});

describe('EstimateItemsBoard — session edit highlight', () => {
  const rowButton = (name: string) => screen.getByText(name).closest('button')!;

  it('an untouched line gets neither highlight', () => {
    render(
      <EstimateItemsBoard
        items={[line({ id: 'a', name: 'Позиція A' })]}
        signed={false}
        onEdit={vi.fn()}
        onArrange={vi.fn()}
      />,
    );
    expect(rowButton('Позиція A').className).not.toContain('border-brand/30');
    expect(rowButton('Позиція A').className).not.toContain('border-success/50');
  });

  it('a line touched earlier this session gets the fainter brand highlight', () => {
    render(
      <EstimateItemsBoard
        items={[line({ id: 'a', name: 'Позиція A' })]}
        signed={false}
        touched={new Set(['a'])}
        onEdit={vi.fn()}
        onArrange={vi.fn()}
      />,
    );
    expect(rowButton('Позиція A').className).toContain('border-brand/30');
    expect(rowButton('Позиція A').className).not.toContain('border-success/50');
  });

  it('the MOST RECENTLY touched line gets the brighter success highlight instead', () => {
    render(
      <EstimateItemsBoard
        items={[
          line({ id: 'a', name: 'Позиція A', sortOrder: 0 }),
          line({ id: 'b', name: 'Позиція B', sortOrder: 1 }),
        ]}
        signed={false}
        touched={new Set(['a', 'b'])}
        lastTouched={new Set(['b'])}
        onEdit={vi.fn()}
        onArrange={vi.fn()}
      />,
    );
    // Both were touched this session, but only the LAST one gets the brighter treatment — the
    // earlier one keeps the plain "touched" look, never both at once.
    expect(rowButton('Позиція A').className).toContain('border-brand/30');
    expect(rowButton('Позиція A').className).not.toContain('border-success/50');
    expect(rowButton('Позиція B').className).toContain('border-success/50');
    expect(rowButton('Позиція B').className).not.toContain('border-brand/30');
  });
});

describe('EstimateItemsBoard — closed by SIGNED acts', () => {
  const rowButton = (name: string) => screen.getByText(name).closest('button')!;

  it('a fully closed line shows the «закрито» chip and the success background', () => {
    render(
      <EstimateItemsBoard
        items={[line({ id: 'a', name: 'Позиція A', quantity: 10, closedByActs: 10 })]}
        signed
        onEdit={vi.fn()}
        onArrange={vi.fn()}
      />,
    );
    expect(screen.getByText('✓ закрито')).toBeTruthy();
    expect(rowButton('Позиція A').className).toContain('bg-success-soft');
  });

  it('a partially closed line shows a «done / total» chip, not the «закрито» one', () => {
    render(
      <EstimateItemsBoard
        items={[line({ id: 'a', name: 'Позиція A', quantity: 10, closedByActs: 4 })]}
        signed
        onEdit={vi.fn()}
        onArrange={vi.fn()}
      />,
    );
    // Number nodes split, so assert against the row's full text rather than an exact node.
    // formatNumber trims trailing zeros, so the chip reads «4 / 10».
    expect(rowButton('Позиція A').textContent).toContain('4 / 10');
    expect(screen.queryByText('✓ закрито')).toBeNull();
  });

  it('closedByActs=null (only a DRAFT act, or nothing) colours and chips nothing', () => {
    render(
      <EstimateItemsBoard
        items={[line({ id: 'a', name: 'Позиція A', quantity: 10, closedByActs: null })]}
        signed
        onEdit={vi.fn()}
        onArrange={vi.fn()}
      />,
    );
    expect(screen.queryByText('✓ закрито')).toBeNull();
    expect(rowButton('Позиція A').className).not.toContain('bg-success-soft');
  });
});

describe('EstimateItemsBoard — scroll anchor', () => {
  it('every row carries data-item-id, the anchor the editor scrolls a just-added line to', () => {
    // The editor finds the row by this attribute (rows are nested inside category sections, so it
    // cannot hold a ref per line). Drop it and the auto-scroll dies silently — nothing throws.
    const { container } = render(
      <EstimateItemsBoard
        items={[
          line({ id: 'a', name: 'Позиція A', sortOrder: 0 }),
          line({ id: 'b', name: 'Позиція B', sortOrder: 1 }),
        ]}
        signed={false}
        onEdit={vi.fn()}
        onArrange={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-item-id="a"]')).toBeTruthy();
    expect(container.querySelector('[data-item-id="b"]')).toBeTruthy();
  });
});
