import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/lib/i18n.ts';
import { InfoPopover } from './InfoPopover.tsx';

describe('InfoPopover', () => {
  it('is closed by default and opens on tap, showing the text', () => {
    render(<InfoPopover text="Сума всіх підписаних кошторисів об'єкта." label="За договором" />);

    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'За договором' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText("Сума всіх підписаних кошторисів об'єкта.")).toBeTruthy();
  });

  it('renders its panel on the body, outside a clipping ancestor', () => {
    render(
      <div data-testid="card" className="overflow-hidden">
        <InfoPopover text="Пояснення" label="Тест" />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Тест' }));

    const panel = screen.getByRole('dialog');
    expect(screen.getByTestId('card').contains(panel)).toBe(false);
    expect(document.body.contains(panel)).toBe(true);
  });

  it('closes on a second tap of the trigger', () => {
    render(<InfoPopover text="Пояснення" label="Тест" />);
    const trigger = screen.getByRole('button', { name: 'Тест' });

    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog')).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on a tap outside (the scrim)', () => {
    render(<InfoPopover text="Пояснення" label="Тест" />);
    fireEvent.click(screen.getByRole('button', { name: 'Тест' }));

    // Two "Закрити" buttons exist while open (the scrim and the ✕ inside the panel) — the scrim
    // is the FIRST one, matching the render order in the component.
    fireEvent.click(screen.getAllByRole('button', { name: 'Закрити' })[0]);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on the ✕ inside the panel', () => {
    render(<InfoPopover text="Пояснення" label="Тест" />);
    fireEvent.click(screen.getByRole('button', { name: 'Тест' }));

    fireEvent.click(screen.getAllByRole('button', { name: 'Закрити' })[1]);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape', () => {
    render(<InfoPopover text="Пояснення" label="Тест" />);
    fireEvent.click(screen.getByRole('button', { name: 'Тест' }));

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders children instead of text when both would otherwise apply', () => {
    render(
      <InfoPopover label="Тест">
        <span>Дитячий вміст</span>
      </InfoPopover>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Тест' }));

    expect(screen.getByText('Дитячий вміст')).toBeTruthy();
  });
});
