import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
        estimateId="test-est"
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
        estimateId="test-est"
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
        estimateId="test-est"
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
        estimateId="test-est"
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
        estimateId="test-est"
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
        estimateId="test-est"
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
        estimateId="test-est"
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
        estimateId="test-est"
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
        estimateId="test-est"
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

describe('EstimateItemsBoard — the explanation a line carries from the catalog', () => {
  const Q4 = 'Підготовка ГКЛ під фарбування · Q4 (еліт)';
  const MEANS = 'Найвищий рівень: під глянцеву фарбу.';
  const infoTriggers = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-haspopup="dialog"]'));

  it('keeps the explanation behind an (i), never inline under the name', () => {
    // «звідки клієнт має знати що це таке?» — V119 froze the catalog wording onto the line, and
    // this board is where the master meets it. V121 moved it BESIDE the row: rendered inline it
    // ran the width of the board and pushed the whole estimate sideways («все пливе»).
    const { container } = render(
      <EstimateItemsBoard
        estimateId="test-est"
        items={[line({ id: 'a', name: Q4, description: MEANS })]}
        signed={false}
        onEdit={vi.fn()}
        onArrange={vi.fn()}
      />,
    );
    expect(screen.queryByText(MEANS)).toBeNull();

    const info = infoTriggers(container);
    expect(info).toHaveLength(1);
    fireEvent.click(info[0]);
    expect(screen.getByText(MEANS)).toBeTruthy();
  });

  it('leaves a line the master typed himself with nothing but its own name', () => {
    const { container } = render(
      <EstimateItemsBoard
        estimateId="test-est"
        items={[
          line({ id: 'a', name: Q4, description: MEANS, sortOrder: 0 }),
          line({ id: 'b', name: 'Демонтаж', description: null, sortOrder: 1 }),
        ]}
        signed={false}
        onEdit={vi.fn()}
        onArrange={vi.fn()}
      />,
    );
    // Exactly one (i) — the explanation belongs to the row that carries the text, and an
    // unexplained position must not inherit its neighbour's.
    expect(infoTriggers(container)).toHaveLength(1);
    expect(screen.getByText('Демонтаж').closest('button')!.textContent).not.toContain('рівень');
  });

  it('never puts the (i) inside the row button — that would be invalid markup', () => {
    const { container } = render(
      <EstimateItemsBoard
        estimateId="test-est"
        items={[line({ id: 'a', name: Q4, description: MEANS })]}
        signed={false}
        onEdit={vi.fn()}
        onArrange={vi.fn()}
      />,
    );
    // The trigger IS a button, so what must hold is that nothing above it is one.
    expect(infoTriggers(container)[0].parentElement!.closest('button')).toBeNull();
  });
});

describe('EstimateItemsBoard — trade badge on category header (V125 iteration)', () => {
  it('renders a trade badge when the estimate carries ≥ 2 distinct non-null trades', () => {
    render(
      <EstimateItemsBoard
        estimateId="badge-yes"
        items={[
          line({ id: '1', name: 'A', category: 'Каркас', trade: 'DRYWALL', sortOrder: 0 }),
          line({ id: '2', name: 'B', category: 'Каркас', trade: 'DRYWALL', sortOrder: 1 }),
          line({ id: '3', name: 'C', category: 'Фарбування', trade: 'PAINTER', sortOrder: 2 }),
        ]}
        signed={false}
        onEdit={vi.fn()}
        onArrange={vi.fn()}
      />,
    );
    // Both trade names visible on the two category headers.
    expect(screen.getByText('Гіпсокартон')).toBeTruthy();
    expect(screen.getByText('Малярні роботи')).toBeTruthy();
  });

  it('draws NOTHING on a single-trade estimate — the 95 % case must stay clean', () => {
    render(
      <EstimateItemsBoard
        estimateId="badge-no"
        items={[
          line({ id: '1', name: 'A', category: 'Каркас', trade: 'DRYWALL', sortOrder: 0 }),
          line({ id: '2', name: 'B', category: 'Каркас', trade: 'DRYWALL', sortOrder: 1 }),
        ]}
        signed={false}
        onEdit={vi.fn()}
        onArrange={vi.fn()}
      />,
    );
    // Trade label appears nowhere: single trade → no badge.
    expect(screen.queryByText('Гіпсокартон')).toBeNull();
  });

  it('a NULL trade does NOT count as a distinct trade (see V125 header)', () => {
    // One row labelled, one row NULL: still one trade, not two — otherwise every single-trade sheet
    // with typed rows would light up its own badge.
    render(
      <EstimateItemsBoard
        estimateId="badge-null"
        items={[
          line({ id: '1', name: 'A', category: 'Каркас', trade: 'DRYWALL', sortOrder: 0 }),
          line({ id: '2', name: 'B', category: 'Ручне', trade: null, sortOrder: 1 }),
        ]}
        signed={false}
        onEdit={vi.fn()}
        onArrange={vi.fn()}
      />,
    );
    expect(screen.queryByText('Гіпсокартон')).toBeNull();
  });
});

describe('EstimateItemsBoard — category collapse (V125 iteration)', () => {
  beforeEach(() => localStorage.clear());

  it('categories start EXPANDED — the default the master asked for', () => {
    render(
      <EstimateItemsBoard
        estimateId="collapse-a"
        items={[line({ id: '1', name: 'Позиція', category: 'Каркас', sortOrder: 0 })]}
        signed={false}
        onEdit={vi.fn()}
        onArrange={vi.fn()}
      />,
    );
    expect(screen.getByText('Позиція')).toBeTruthy();
  });

  it('tapping the header hides the rows; tapping again restores them', () => {
    render(
      <EstimateItemsBoard
        estimateId="collapse-b"
        items={[
          line({ id: '1', name: 'Позиція 1', category: 'Каркас', sortOrder: 0 }),
          line({ id: '2', name: 'Позиція 2', category: 'Каркас', sortOrder: 1 }),
        ]}
        signed={false}
        onEdit={vi.fn()}
        onArrange={vi.fn()}
      />,
    );
    const toggle = screen.getByLabelText(/Згорнути категорію «Каркас»/);

    fireEvent.click(toggle);
    expect(screen.queryByText('Позиція 1')).toBeNull();
    expect(screen.queryByText('Позиція 2')).toBeNull();
    // A collapsed header still tells the master how many lines are hidden.
    expect(screen.getByText('(2)')).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/Розгорнути категорію «Каркас»/));
    expect(screen.getByText('Позиція 1')).toBeTruthy();
    expect(screen.getByText('Позиція 2')).toBeTruthy();
  });

  it('the fold state survives a remount — localStorage is the memory, keyed per estimate', () => {
    const { unmount } = render(
      <EstimateItemsBoard
        estimateId="collapse-c"
        items={[line({ id: '1', name: 'Позиція', category: 'Каркас', sortOrder: 0 })]}
        signed={false}
        onEdit={vi.fn()}
        onArrange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Згорнути категорію «Каркас»/));
    unmount();

    render(
      <EstimateItemsBoard
        estimateId="collapse-c"
        items={[line({ id: '1', name: 'Позиція', category: 'Каркас', sortOrder: 0 })]}
        signed={false}
        onEdit={vi.fn()}
        onArrange={vi.fn()}
      />,
    );
    expect(screen.queryByText('Позиція')).toBeNull();          // still folded
    expect(screen.getByLabelText(/Розгорнути категорію «Каркас»/)).toBeTruthy();
  });

  it('a different estimateId does NOT inherit another estimate’s fold state', () => {
    // The whole reason for the per-estimate key: a fold state carried across estimates would hide
    // a category the master never touched on this sheet.
    render(
      <EstimateItemsBoard
        estimateId="est-A"
        items={[line({ id: '1', name: 'A', category: 'Каркас', sortOrder: 0 })]}
        signed={false}
        onEdit={vi.fn()}
        onArrange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Згорнути категорію «Каркас»/));

    // Second estimate mounts with the same category name but a different id — must render expanded.
    render(
      <EstimateItemsBoard
        estimateId="est-B"
        items={[line({ id: '1', name: 'B', category: 'Каркас', sortOrder: 0 })]}
        signed={false}
        onEdit={vi.fn()}
        onArrange={vi.fn()}
      />,
    );
    expect(screen.getByText('B')).toBeTruthy();
  });
});
