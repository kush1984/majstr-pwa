import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/lib/i18n.ts';
import { EstimateItemsBoard } from './EstimateItemsBoard.tsx';
import type { EstimateItemResponse } from '@/api/types.ts';

const line = (over: Partial<EstimateItemResponse> = {}): EstimateItemResponse => ({
  id: 'x', type: 'WORK', name: 'Стяжка', category: null, unit: 'M2',
  quantity: 17.1, unitPrice: 650, lineTotal: 11115, sortOrder: 0,
  measurementRefs: [], quantityManual: false,
  percentBaseKind: null, percentBaseItemId: null, baseDetached: false, baseOriginLabel: null, closedByActs: null,
  ...over,
});

function board(items: EstimateItemResponse[], opts: { signed?: boolean; onInline?: ReturnType<typeof vi.fn> } = {}) {
  const onInline = opts.onInline ?? vi.fn();
  const onEdit = vi.fn();
  render(
    <EstimateItemsBoard
      estimateId="e1"
      items={items}
      signed={opts.signed ?? false}
      onEdit={onEdit}
      onInline={onInline}
      onArrange={vi.fn()}
    />,
  );
  return { onInline, onEdit };
}

function type(label: string, value: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
  const input = screen.getByRole('textbox', { name: label });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('estimate row — inline editing', () => {
  it('quantity, price and name save from the row', () => {
    const { onInline } = board([line()]);
    type('Кількість, Стяжка', '20');
    expect(onInline).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'x' }), { quantity: 20 }, 'quantity');
    // Enter moved on to the next cell along the row — the price is already open.
    const price = screen.getByRole('textbox', { name: 'Ціна, Стяжка' });
    fireEvent.change(price, { target: { value: '700' } });
    fireEvent.keyDown(price, { key: 'Escape' });
    expect(onInline).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ціна, Стяжка' }));
    const again = screen.getByRole('textbox', { name: 'Ціна, Стяжка' });
    fireEvent.change(again, { target: { value: '700' } });
    fireEvent.blur(again);
    expect(onInline).toHaveBeenLastCalledWith(expect.anything(), { unitPrice: 700 }, 'price');
    type('Назва, Стяжка', 'Стяжка цементна');
    expect(onInline).toHaveBeenLastCalledWith(expect.anything(), { name: 'Стяжка цементна' }, 'name');
  });

  it('a typed quantity on a measured line becomes manual', () => {
    const { onInline } = board([line({ measurementRefs: ['m1'] })]);
    type('Кількість, Стяжка', '20');
    expect(onInline).toHaveBeenLastCalledWith(expect.anything(), { quantity: 20, quantityManual: true }, 'quantity');
  });

  it('shows «✎ вручну» beside a quantity typed over measurements', () => {
    board([line({ measurementRefs: ['m1'], quantityManual: true })]);
    expect(screen.getByText('✎ вручну')).toBeTruthy();
  });

  it('a typed sum becomes a price at the kopeck, and offers «Округлити ціну»', () => {
    const { onInline } = board([line()]);
    type('Сума, Стяжка', '11500');
    expect(onInline).toHaveBeenLastCalledWith(expect.anything(), { unitPrice: 672.51 }, 'sum');
    fireEvent.click(screen.getByRole('button', { name: 'Округлити ціну' }));
    expect(onInline).toHaveBeenLastCalledWith(expect.anything(), { unitPrice: 673 }, 'price');
  });

  it('a quantity of 0: «к-сть?» where the number goes, a dash for the sum, no sentence under it', () => {
    board([line({ quantity: 0, lineTotal: 0 })]);
    expect(screen.queryByRole('button', { name: 'Сума, Стяжка' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Кількість, Стяжка' }).textContent).toBe('к-сть?');
    expect(screen.queryByText('Спершу вкажіть кількість')).toBeNull();
  });

  it('the sum follows the quantity WHILE it is typed, greyed, and sends nothing until commit', () => {
    const { onInline } = board([line({ quantity: 10, unitPrice: 90, lineTotal: 900 })]);
    fireEvent.click(screen.getByRole('button', { name: 'Кількість, Стяжка' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Кількість, Стяжка' }), { target: { value: '12' } });
    const sum = screen.getByRole('button', { name: 'Сума, Стяжка' });
    expect(sum.textContent).toBe('1 080,00');
    expect(sum.className).toContain('text-faint');
    expect(onInline).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Кількість, Стяжка' }), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Сума, Стяжка' }).textContent).toBe('900,00');
  });

  it('a «%» line edits only its percent, keeps a discount negative, and shows the sign', () => {
    const { onInline } = board([
      line({ id: 'w' }),
      line({ id: 'd', name: 'Знижка', unit: 'PERCENT', quantity: -15, unitPrice: 0, lineTotal: -1667.25, percentBaseKind: 'TOTAL', sortOrder: 1 }),
    ]);
    expect(screen.queryByRole('button', { name: 'Сума, Знижка' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ціна, Знижка' })).toBeNull();
    expect(screen.getByText('−')).toBeTruthy();
    type('Відсоток, Знижка', '20');
    expect(onInline).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'd' }), { quantity: -20 }, 'percent');
  });

  it('«⋯» opens the full dialog', () => {
    const { onEdit } = board([line()]);
    fireEvent.click(screen.getByRole('button', { name: 'Усі поля позиції «Стяжка»' }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'x' }));
  });

  it('a signed estimate has no cells at all', () => {
    board([line()], { signed: true });
    expect(screen.queryByRole('button', { name: 'Кількість, Стяжка' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Назва, Стяжка' })).toBeNull();
  });

  it('without onInline (flag off) the row is the old button that opens the dialog', () => {
    const onEdit = vi.fn();
    render(<EstimateItemsBoard estimateId="e1" items={[line()]} signed={false} onEdit={onEdit} onArrange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Кількість, Стяжка' })).toBeNull();
    fireEvent.click(screen.getByText('Стяжка').closest('button')!);
    expect(onEdit).toHaveBeenCalled();
  });
});
