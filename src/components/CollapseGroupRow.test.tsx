import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollapseGroupRow } from './CollapseGroupRow.tsx';

/**
 * The chevron that shows which way this row sits is `aria-hidden`, so `aria-expanded` is the only
 * thing that carries the state to a screen reader. Without it the row was announced as a bare green
 * line with no hint that it folds anything.
 */
describe('CollapseGroupRow', () => {
  it('announces that it is collapsed', () => {
    render(<CollapseGroupRow label="✓ Куплено · 14" expanded={false} onToggle={() => undefined} />);

    const row = screen.getByRole('button', { name: '✓ Куплено · 14' });
    expect(row.getAttribute('aria-expanded')).toBe('false');
  });

  it('announces that it is expanded', () => {
    render(<CollapseGroupRow label="✓ Отримано · 5" expanded onToggle={() => undefined} />);

    expect(screen.getByRole('button', { name: '✓ Отримано · 5' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('folds on a tap', () => {
    const onToggle = vi.fn();
    render(<CollapseGroupRow label="✓ Куплено · 2" expanded onToggle={onToggle} />);

    fireEvent.click(screen.getByRole('button', { name: '✓ Куплено · 2' }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
