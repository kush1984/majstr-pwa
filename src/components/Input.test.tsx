import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Input, hasOwnWidth } from './Input.tsx';

describe('Input width', () => {
  it('fills its row by default', () => {
    const { container } = render(<Input />);
    expect(container.querySelector('input')?.className.split(' ')).toContain('w-full');
  });

  // Tailwind emits `w-full` after `w-28`, so both classes on one field meant a full-width field.
  it("drops w-full when the caller sizes the field — the caller's width is the one that applies", () => {
    const { container } = render(<Input className="w-28" />);
    const classes = container.querySelector('input')?.className.split(' ') ?? [];
    expect(classes).toContain('w-28');
    expect(classes).not.toContain('w-full');
  });

  it('a responsive width alone keeps the phone default', () => {
    expect(hasOwnWidth('sm:w-40')).toBe(false);
    expect(hasOwnWidth('text-lg w-16')).toBe(true);
  });
});
