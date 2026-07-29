import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
