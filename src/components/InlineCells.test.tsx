import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@/lib/i18n.ts';
import { InlineNumberCell } from './InlineNumberCell.tsx';
import { InlineTextCell } from './InlineTextCell.tsx';

function openCell(label: string): HTMLInputElement {
  fireEvent.click(screen.getByRole('button', { name: label }));
  return screen.getByRole<HTMLInputElement>('textbox', { name: label });
}

describe('InlineNumberCell', () => {
  it('commits a new value on Enter and leaves edit mode', () => {
    const onCommit = vi.fn();
    render(<InlineNumberCell value={10} kind="quantity" ariaLabel="Кількість, Стяжка" onCommit={onCommit} />);
    const input = openCell('Кількість, Стяжка');
    fireEvent.change(input, { target: { value: '12,5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(12.5);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('commits on blur, once — the blur after Enter does not save twice', () => {
    const onCommit = vi.fn();
    render(<InlineNumberCell value={10} kind="money" ariaLabel="Ціна, Стяжка" onCommit={onCommit} />);
    const input = openCell('Ціна, Стяжка');
    fireEvent.change(input, { target: { value: '650' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the value did not change', () => {
    const onCommit = vi.fn();
    render(<InlineNumberCell value={650} kind="money" ariaLabel="Ціна, Стяжка" onCommit={onCommit} />);
    const input = openCell('Ціна, Стяжка');
    fireEvent.change(input, { target: { value: '650,00' } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('saves EMPTY as 0', () => {
    const onCommit = vi.fn();
    render(<InlineNumberCell value={5} kind="quantity" ariaLabel="Кількість, Стяжка" onCommit={onCommit} />);
    const input = openCell('Кількість, Стяжка');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(0);
  });

  it('a non-number turns the frame red and is not saved', () => {
    const onCommit = vi.fn();
    render(<InlineNumberCell value={5} kind="quantity" ariaLabel="Кількість, Стяжка" onCommit={onCommit} />);
    const input = openCell('Кількість, Стяжка');
    fireEvent.change(input, { target: { value: '-5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    // Leaving the field with garbage puts the old value back.
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Кількість, Стяжка' }).textContent).toBe('5');
  });

  it('Esc cancels: no request, the old value is back', () => {
    const onCommit = vi.fn();
    render(<InlineNumberCell value={5} kind="quantity" ariaLabel="Кількість, Стяжка" onCommit={onCommit} />);
    const input = openCell('Кількість, Стяжка');
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('«Далі ↓» saves and opens the next cell along the row, then the next row', () => {
    const qty = vi.fn();
    const price = vi.fn();
    render(
      <div>
        <div>
          <InlineNumberCell value={1} kind="quantity" ariaLabel="Кількість, А" onCommit={qty} />
          <InlineNumberCell value={100} kind="money" ariaLabel="Ціна, А" onCommit={price} />
        </div>
        <div>
          <InlineNumberCell value={2} kind="quantity" ariaLabel="Кількість, Б" onCommit={vi.fn()} />
        </div>
      </div>,
    );
    const first = openCell('Кількість, А');
    fireEvent.change(first, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далі ↓' }));
    expect(qty).toHaveBeenCalledWith(3);
    const second = screen.getByRole('textbox', { name: 'Ціна, А' });
    fireEvent.keyDown(second, { key: 'Enter' });
    expect(screen.getByRole('textbox', { name: 'Кількість, Б' })).toBeTruthy();
  });

  it('the app going to the background saves what was typed', () => {
    const onCommit = vi.fn();
    render(<InlineNumberCell value={5} kind="quantity" ariaLabel="Кількість, Стяжка" onCommit={onCommit} />);
    const input = openCell('Кількість, Стяжка');
    fireEvent.change(input, { target: { value: '7' } });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    visibility.mockRestore();
    expect(onCommit).toHaveBeenCalledWith(7);
  });

  it('read-only: plain text, no button to tap', () => {
    render(<InlineNumberCell value={5} kind="quantity" ariaLabel="Кількість, Стяжка" onCommit={vi.fn()} readOnly />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('5')).toBeTruthy();
  });
});

describe('InlineTextCell', () => {
  it('saves a trimmed new name on «Готово»', () => {
    const onCommit = vi.fn();
    render(<InlineTextCell value="Стяжка" ariaLabel="Назва, Стяжка" onCommit={onCommit} />);
    const input = openCell('Назва, Стяжка');
    fireEvent.change(input, { target: { value: '  Стяжка цементна ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Стяжка цементна');
  });

  it('an empty name is not saved — the old one comes back, no error', () => {
    const onCommit = vi.fn();
    render(<InlineTextCell value="Стяжка" ariaLabel="Назва, Стяжка" onCommit={onCommit} />);
    const input = openCell('Назва, Стяжка');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Назва, Стяжка' }).textContent).toBe('Стяжка');
  });

  it('«Скасувати» cancels without the blur saving first', () => {
    const onCommit = vi.fn();
    render(<InlineTextCell value="Стяжка" ariaLabel="Назва, Стяжка" onCommit={onCommit} />);
    const input = openCell('Назва, Стяжка');
    fireEvent.change(input, { target: { value: 'Інше' } });
    const cancel = screen.getByRole('button', { name: 'Скасувати' });
    fireEvent.pointerDown(cancel);
    fireEvent.mouseDown(cancel);
    fireEvent.click(cancel);
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
