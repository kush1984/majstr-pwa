import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/lib/i18n.ts';
import { MeasurementItemForm } from './MeasurementItemForm.tsx';
import { asButton, asInput } from '@/test/dom.ts';

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

  it('LINEAR «Довжина» mode is a plain length (width × qty), no reveal sides', () => {
    const onSave = vi.fn();
    render(<MeasurementItemForm onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/Стеля/), { target: { value: 'Плінтус' } });
    fireEvent.click(screen.getByRole('button', { name: 'Пагонаж' }));
    fireEvent.click(screen.getByRole('button', { name: 'Довжина' }));
    // The reveal-side toggles are gone in length mode.
    expect(screen.queryByRole('button', { name: 'Верх' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Довжина, м'), { target: { value: '8.535' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    expect(onSave).toHaveBeenCalledWith({
      name: 'Плінтус',
      type: 'LINEAR',
      payload: { height: 0, width: 8.535, sides: { left: true, right: true, top: true, bottom: false }, qty: 1, mode: 'length' },
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
    expect(asInput(screen.getByLabelText(/^a ширина/)).value).toBe('5.31');
    expect(asInput(screen.getByLabelText(/^b висота/)).value).toBe('3.69');
    expect(screen.getByRole('button', { name: 'м' }).className).toContain('border-brand');
  });

  it('opens an imported EMPTY (to-measure) surface as one blank rectangle, not «площа напряму»', () => {
    render(
      <MeasurementItemForm
        initial={{
          id: 'w1', name: 'Стіна 1', type: 'SURFACE', unit: 'M2', result: 0, sortOrder: 0,
          payload: { segments: [], openings: [] },
        }}
        onSave={vi.fn()}
        onCancel={() => {}}
      />,
    );
    // A blank rectangle with empty a/b fields — ready to measure, never a locked direct area.
    expect(asInput(screen.getByLabelText(/^a ширина/)).value).toBe('');
    expect(asInput(screen.getByLabelText(/^b висота/)).value).toBe('');
    expect(screen.getByRole('button', { name: 'Прямокутник' }).className).toContain('bg-primary');
  });

  it('keeps save disabled until there is a name and a positive result', () => {
    const onSave = vi.fn();
    render(<MeasurementItemForm onSave={onSave} onCancel={() => {}} />);
    // No name, no dimensions → save disabled.
    const save = screen.getByRole('button', { name: 'Зберегти' });
    expect(asButton(save).disabled).toBe(true);
  });

  it('builds a SHTROBA payload (explicit bus + per-drop chase) as the chase/cable calculator', () => {
    const onSave = vi.fn();
    render(<MeasurementItemForm allowedTypes={['SHTROBA']} onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/Стеля/), { target: { value: 'Вітальня' } });
    // Explicit bus length (mm) — the fix for the wrongly-guessed «магістраль». One default
    // socket drop (h=300), bus level 2600, both chased, 10% reserve.
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '1000' } });

    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    expect(onSave).toHaveBeenCalledWith({
      name: 'Вітальня',
      type: 'SHTROBA',
      payload: {
        busLevel: 2600,
        busFromTop: true,
        busLength: 1000,
        busChase: true,
        reservePct: 10,
        points: [{ kind: 'socket', h: 300, qty: 1, chase: true }],
      },
    });
  });

  it('lets a drop be wired but NOT chased (un-plastered wall) via its per-drop toggle', () => {
    const onSave = vi.fn();
    render(<MeasurementItemForm allowedTypes={['SHTROBA']} onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/Стеля/), { target: { value: 'Гараж' } });
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '500' } });
    // Untick «Штробити» on the single drop — the point stays in the cable, drops out of the chase.
    fireEvent.click(screen.getByRole('button', { name: 'Штробити' }));

    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SHTROBA',
        payload: expect.objectContaining({
          points: [{ kind: 'socket', h: 300, qty: 1, chase: false }],
        }),
      }),
    );
  });
});
