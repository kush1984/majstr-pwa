import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/lib/i18n.ts';
import { MeasurementItemForm } from './MeasurementItemForm.tsx';

describe('MeasurementItemForm', () => {
  it('builds a LINEAR payload (perimeter sides × count) and computes the result', () => {
    const onSave = vi.fn();
    render(<MeasurementItemForm onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/Стеля/), { target: { value: 'Відкоси вікна' } });
    fireEvent.click(screen.getByRole('button', { name: 'Пагонаж' }));
    fireEvent.change(screen.getByPlaceholderText('Висота отв.'), { target: { value: '1.5' } });
    fireEvent.change(screen.getByPlaceholderText('Ширина отв.'), { target: { value: '1' } });
    fireEvent.change(screen.getByPlaceholderText('К-сть'), { target: { value: '3' } });

    // (H + H + W) × qty = (1.5 + 1.5 + 1) × 3 = 12 (default sides: left/right/top, no bottom)
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    expect(onSave).toHaveBeenCalledWith({
      name: 'Відкоси вікна',
      type: 'LINEAR',
      payload: {
        height: 1.5,
        width: 1,
        sides: { left: true, right: true, top: true, bottom: false },
        qty: 3,
      },
    });
  });

  it('keeps save disabled until there is a name and a positive result', () => {
    const onSave = vi.fn();
    render(<MeasurementItemForm onSave={onSave} onCancel={() => {}} />);
    // No name, no dimensions → save disabled.
    const save = screen.getByRole('button', { name: 'Зберегти' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });
});
