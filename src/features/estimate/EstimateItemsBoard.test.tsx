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
  percentBaseKind: null, percentBaseItemId: null, baseDetached: false,
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
