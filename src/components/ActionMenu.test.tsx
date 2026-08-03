import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/lib/i18n.ts';
import { ActionMenu, ActionMenuItem } from './ActionMenu.tsx';

/**
 * The menu panel must escape whatever box the row sits in.
 *
 * The dashboard's «Останні об'єкти» card has `overflow-hidden` for its rounded corners, and an
 * ordinary absolutely-positioned panel was clipped by it — the menu came out sliced, its label cut
 * mid-word. Clipping is not stacking, so no z-index fixes it; the panel has to leave the ancestor
 * entirely. That is a structural fact about the DOM, which is why it is asserted here rather than
 * left to a CSS class that would be silently correct-looking if removed.
 */
function renderInsideAClippingCard(onPick = vi.fn()) {
  return render(
    <div data-testid="card" className="overflow-hidden rounded-2xl">
      <ActionMenu ariaLabel="Дії">
        {(close) => (
          <ActionMenuItem icon="🗑" label="Видалити" onClick={() => { close(); onPick(); }} />
        )}
      </ActionMenu>
    </div>,
  );
}

describe('ActionMenu', () => {
  it('renders its panel outside the clipping card, on the body', () => {
    renderInsideAClippingCard();
    fireEvent.click(screen.getByRole('button', { name: 'Дії' }));

    const item = screen.getByRole('menuitem', { name: /Видалити/ });
    expect(screen.getByTestId('card').contains(item)).toBe(false);
    expect(document.body.contains(item)).toBe(true);
  });

  it('opens on the trigger and closes again on a second tap', () => {
    renderInsideAClippingCard();
    const trigger = screen.getByRole('button', { name: 'Дії' });

    fireEvent.click(trigger);
    expect(screen.queryByRole('menuitem')).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(trigger);
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('closes when the action runs, so a sheet never opens under a still-open menu', () => {
    const onPick = vi.fn();
    renderInsideAClippingCard(onPick);
    fireEvent.click(screen.getByRole('button', { name: 'Дії' }));

    fireEvent.click(screen.getByRole('menuitem', { name: /Видалити/ }));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('closes on a tap anywhere else', () => {
    renderInsideAClippingCard();
    fireEvent.click(screen.getByRole('button', { name: 'Дії' }));

    fireEvent.click(screen.getByRole('button', { name: 'Закрити' }));

    expect(screen.queryByRole('menuitem')).toBeNull();
  });
});
