import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/lib/i18n.ts';
import { CatalogBoard } from './CatalogBoard.tsx';
import type { CatalogItemResponse } from '@/api/types.ts';
import { catalogKey, indexCatalog } from '@/lib/catalogMatch.ts';

const position = (over: Partial<CatalogItemResponse> = {}): CatalogItemResponse => ({
  id: 'c1', name: 'Стяжка', category: 'Стяжка', trade: 'FLOORING', customTradeId: null,
  customTradeName: null, type: 'WORK', unit: 'M2', defaultPrice: 650, sortOrder: 0,
  ...over,
} as CatalogItemResponse);

function board(onInline = vi.fn()) {
  const onEdit = vi.fn();
  render(
    <CatalogBoard
      sections={[{ category: 'Стяжка', items: [position()] }]}
      onEdit={onEdit}
      onInline={onInline}
      isCategoryOpen={() => true}
    />,
  );
  return { onInline, onEdit };
}

function type(label: string, value: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
  const input = screen.getByRole('textbox', { name: label });
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe('catalog row — inline editing', () => {
  it('a new price saves from the row', () => {
    const { onInline } = board();
    type('Ціна, Стяжка', '700');
    expect(onInline).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }), { defaultPrice: 700 }, 'price');
  });

  it('an emptied or zero price is never saved — the catalog keeps the old one', () => {
    const { onInline } = board();
    type('Ціна, Стяжка', '');
    type('Ціна, Стяжка', '0');
    expect(onInline).not.toHaveBeenCalled();
  });

  it('a new name saves from the row', () => {
    const { onInline } = board();
    type('Назва, Стяжка', 'Стяжка цементна');
    expect(onInline).toHaveBeenCalledWith(expect.anything(), { name: 'Стяжка цементна' }, 'name');
  });

  it('«⋯» opens the dialog for trade, category, unit and description', () => {
    const { onEdit } = board();
    fireEvent.click(screen.getByRole('button', { name: 'Усі поля позиції «Стяжка»' }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
  });
});

describe('catalogKey', () => {
  it('matches by trimmed, case-folded name + type + unit — and a unit apart is another position', () => {
    const byKey = indexCatalog([position(), position({ id: 'c2', unit: 'LINEAR_METER', defaultPrice: 120 })]);
    expect(byKey.get(catalogKey('  стяжка ', 'WORK', 'M2'))?.id).toBe('c1');
    expect(byKey.get(catalogKey('Стяжка', 'WORK', 'LINEAR_METER'))?.id).toBe('c2');
    expect(byKey.get(catalogKey('Стяжка', 'MATERIAL', 'M2'))).toBeUndefined();
  });
});
