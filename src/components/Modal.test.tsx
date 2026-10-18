import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/lib/i18n.ts';
import { Modal } from './Modal.tsx';

/**
 * The modal, and specifically where in the DOM it ends up.
 *
 * <p>It positions itself with `fixed inset-0`, which is resolved against the nearest ancestor carrying
 * a transform — not the viewport. Rendered in place inside, say, a `-translate-y-1/2` wrapper, the sheet
 * measured itself against a 32px button and collapsed into a sliver of a column. That is what the portal
 * is for, and it is invisible in the modal's own markup, so it is pinned here.</p>
 */
describe('Modal', () => {
  it('escapes a transformed ancestor instead of being sized by it', () => {
    const { container } = render(
      <div className="absolute -translate-y-1/2" style={{ transform: 'translateY(-50%)' }}>
        <Modal open onClose={vi.fn()} title="Посилання на чат">
          <p>Скопіювати</p>
        </Modal>
      </div>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    // Not under the transformed wrapper — that is the whole point.
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.closest('[style*="translate"]')).toBeNull();
  });

  it('renders nothing when closed', () => {
    render(<Modal open={false} onClose={vi.fn()} title="Нічого"><p>вміст</p></Modal>);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('вміст')).toBeNull();
  });

  it('closes on the backdrop and on Escape', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Закрити"><p>вміст</p></Modal>);

    fireEvent.click(screen.getAllByRole('button', { name: /закрити/i })[0]);
    expect(onClose).toHaveBeenCalled();

    onClose.mockClear();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('ignores the backdrop and Escape when it must be resolved in-content', () => {
    // The consent dialog: closing it without answering would leave the app in a state it cannot use.
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Згода" dismissable={false}>
        <p>вміст</p>
      </Modal>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

/**
 * System «Назад» closes the sheet, not the screen (review P1-1): each open modal has a history
 * entry, Back leaves the TOP one only, a typed-into form asks first, and react-router's own state
 * keys survive our entry.
 */
describe('Modal — system back', () => {
  const back = () => act(() => { window.history.back(); });

  it('Back closes the sheet and leaves the screen where it is', async () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Шторка"><p>body</p></Modal>);

    back();

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('with a sheet opened from a sheet, Back closes only the top one', async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Modal open onClose={outer} title="Перша"><p>1</p></Modal>
        <Modal open onClose={inner} title="Друга"><p>2</p></Modal>
      </>,
    );

    back();

    await waitFor(() => expect(inner).toHaveBeenCalledOnce());
    expect(outer).not.toHaveBeenCalled();
  });

  it('a typed-into form asks «Скасувати зміни?» on Back and on the backdrop', async () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Форма"><input aria-label="Назва" /></Modal>);
    fireEvent.input(screen.getByLabelText('Назва'), { target: { value: 'Кухня' } });

    back();
    expect(await screen.findByText('Скасувати зміни?')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Продовжити редагування' }));
    expect(screen.queryByText('Скасувати зміни?')).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'Закрити' })[0]); // the backdrop
    fireEvent.click(await screen.findByRole('button', { name: 'Скасувати зміни' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closing from the UI takes its entry back out, and the router keys survive it', async () => {
    window.history.replaceState({ usr: null, key: 'k1', idx: 3 }, '');
    const { rerender } = render(<Modal open onClose={() => {}} title="Шторка"><p>x</p></Modal>);
    expect(window.history.state).toMatchObject({ key: 'k1', idx: 3 });

    rerender(<Modal open={false} onClose={() => {}} title="Шторка"><p>x</p></Modal>);

    await waitFor(() => expect(window.history.state).toEqual({ usr: null, key: 'k1', idx: 3 }));
  });
});
