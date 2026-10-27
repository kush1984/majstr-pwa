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

  it('Tab saves and opens the next cell, like «Далі ↓»', () => {
    const qty = vi.fn();
    render(
      <div>
        <InlineNumberCell value={1} kind="quantity" ariaLabel="Кількість, А" onCommit={qty} />
        <InlineNumberCell value={100} kind="money" ariaLabel="Ціна, А" onCommit={vi.fn()} />
      </div>,
    );
    const first = openCell('Кількість, А');
    fireEvent.change(first, { target: { value: '4' } });
    fireEvent.keyDown(first, { key: 'Tab' });
    expect(qty).toHaveBeenCalledWith(4);
    expect(screen.getByRole('textbox', { name: 'Ціна, А' })).toBeTruthy();
  });

  it('reports what is being typed, and null when the cell closes', () => {
    const onDraft = vi.fn();
    render(<InlineNumberCell value={5} kind="quantity" ariaLabel="Кількість, Стяжка" onCommit={vi.fn()} onDraft={onDraft} />);
    const input = openCell('Кількість, Стяжка');
    fireEvent.change(input, { target: { value: '7,5' } });
    expect(onDraft).toHaveBeenLastCalledWith(7.5);
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(onDraft).toHaveBeenLastCalledWith(null);
    fireEvent.change(input, { target: { value: '8' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onDraft).toHaveBeenLastCalledWith(null);
  });

  it('at rest: no frame, a dotted underline; open: a ring, and the value selected whole', () => {
    render(<InlineNumberCell value={650} kind="money" ariaLabel="Ціна, Стяжка" onCommit={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Ціна, Стяжка' });
    expect(button.className).not.toMatch(/\bborder\b/);
    expect(button.querySelector('span')?.className).toContain('border-dotted');
    const input = openCell('Ціна, Стяжка');
    expect(input.className).toContain('ring-2');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it('with a mouse, a key hint instead of the «Далі ↓» bar', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    render(<InlineNumberCell value={5} kind="quantity" ariaLabel="Кількість, Стяжка" onCommit={vi.fn()} />);
    openCell('Кількість, Стяжка');
    expect(screen.getByText('Enter — зберегти · Esc — скасувати · Tab — далі')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Далі ↓' })).toBeNull();
    vi.unstubAllGlobals();
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

  it('a tap puts the caret at the end of the TAPPED word, never selecting the whole name', () => {
    render(<InlineTextCell value="Укладання плитки 300×600" ariaLabel="Назва, Плитка" onCommit={vi.fn()} />);
    const shown = screen.getByRole('button', { name: 'Назва, Плитка' });
    Object.defineProperty(document, 'caretPositionFromPoint', {
      value: () => ({ offsetNode: shown.firstChild, offset: 12 }), // inside «плитки»
      configurable: true,
    });
    fireEvent.click(shown, { detail: 1, clientX: 40, clientY: 10 });
    Reflect.deleteProperty(document, 'caretPositionFromPoint');
    const field = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Назва, Плитка' });
    expect(field.selectionStart).toBe('Укладання плитки'.length);
    expect(field.selectionEnd).toBe('Укладання плитки'.length);
  });

  it('opened from the keyboard, the caret goes to the end of the name', () => {
    render(<InlineTextCell value="Стяжка" ariaLabel="Назва, Стяжка" onCommit={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Назва, Стяжка' }), { key: 'Enter' });
    const field = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Назва, Стяжка' });
    expect(field.selectionStart).toBe(6);
    expect(field.selectionEnd).toBe(6);
  });

  it('at rest a name is selectable text: no frame, no underline', () => {
    render(<InlineTextCell value="Стяжка" ariaLabel="Назва, Стяжка" onCommit={vi.fn()} />);
    const shown = screen.getByRole('button', { name: 'Назва, Стяжка' });
    expect(shown.className).not.toMatch(/\bborder\b/);
    expect(shown.className).not.toContain('border-dotted');
    expect(shown.className).toContain('select-text');
  });

  it('a pasted line break becomes a space — a name is one line', () => {
    const onCommit = vi.fn();
    render(<InlineTextCell value="Стяжка" ariaLabel="Назва, Стяжка" onCommit={onCommit} />);
    const input = openCell('Назва, Стяжка');
    fireEvent.change(input, { target: { value: 'Стяжка\nцементна' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('Стяжка цементна');
  });

  it('with a mouse, a key hint instead of «Скасувати · Готово»', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    render(<InlineTextCell value="Стяжка" ariaLabel="Назва, Стяжка" onCommit={vi.fn()} />);
    openCell('Назва, Стяжка');
    expect(screen.getByText('Enter — зберегти · Esc — скасувати')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Готово' })).toBeNull();
    vi.unstubAllGlobals();
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
