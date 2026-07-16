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

  it('builds a SURFACE payload of shaped planes in the chosen unit', () => {
    const onSave = vi.fn();
    render(<MeasurementItemForm onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/Стеля/), { target: { value: 'Фронтон' } });
    fireEvent.click(screen.getByRole('button', { name: 'см' }));
    fireEvent.click(screen.getByRole('button', { name: 'Трикутник' }));
    // b (основа) and h (висота) — the letters drawn on the diagram.
    fireEvent.change(screen.getByLabelText(/основа/), { target: { value: '400' } });
    fireEvent.change(screen.getByLabelText(/^h висота/), { target: { value: '150' } });

    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    expect(onSave).toHaveBeenCalledWith({
      name: 'Фронтон',
      type: 'SURFACE',
      payload: {
        unit: 'CM',
        segments: [{ shape: 'tri', mode: 'bh', values: { b: 400, h: 150 } }],
        openings: [],
      },
    });
  });

  it('reads a legacy {l, w} surface back as a rectangle plane', () => {
    const onSave = vi.fn();
    render(
      <MeasurementItemForm
        initial={{
          id: 'i1',
          name: 'Стеля',
          type: 'SURFACE',
          unit: 'M2',
          result: 19.594,
          sortOrder: 0,
          payload: { segments: [{ l: 5.31, w: 3.69 }], openings: [] },
        }}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );

    // Pre-shapes rows have no unit — they were metres, and the sides land on a/b.
    expect((screen.getByLabelText(/^a ширина/) as HTMLInputElement).value).toBe('5.31');
    expect((screen.getByLabelText(/^b висота/) as HTMLInputElement).value).toBe('3.69');
    expect(screen.getByRole('button', { name: 'м' }).className).toContain('border-brand');
  });

  it('keeps save disabled until there is a name and a positive result', () => {
    const onSave = vi.fn();
    render(<MeasurementItemForm onSave={onSave} onCancel={() => {}} />);
    // No name, no dimensions → save disabled.
    const save = screen.getByRole('button', { name: 'Зберегти' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });
});
