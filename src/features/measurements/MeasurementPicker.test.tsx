import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { MeasurementPicker } from './MeasurementPicker.tsx';
import { measurementsApi } from '@/api/measurements.ts';
import type { MeasurementsResponse } from '@/api/types.ts';

vi.mock('@/api/measurements.ts', () => ({ measurementsApi: { tree: vi.fn() } }));

const tree: MeasurementsResponse = {
  areaTotal: 30,
  linearTotal: 5,
  pieceTotal: 0,
  rooms: [
    {
      id: 'r1', name: 'Спальня', sortOrder: 0, areaTotal: 30, linearTotal: 5, pieceTotal: 0,
      items: [
        { id: 'i1', name: 'Стеля', type: 'SURFACE', unit: 'M2', result: 20, sortOrder: 0, payload: { segments: [], openings: [] } },
        { id: 'i2', name: 'Підлога', type: 'SURFACE', unit: 'M2', result: 10, sortOrder: 1, payload: { segments: [], openings: [] } },
        { id: 'i3', name: 'Відкоси', type: 'LINEAR', unit: 'LINEAR_METER', result: 5, sortOrder: 2, payload: { height: 0, width: 0, sides: { left: true, right: true, top: true, bottom: false }, qty: 1 } },
      ],
    },
  ],
};

function renderPicker(props: Partial<Parameters<typeof MeasurementPicker>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onApply = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  render(
    <MeasurementPicker objectId="p1" unit="M2" selectedIds={['i1']} quantityManual={false}
      onApply={onApply} onClose={() => {}} {...props} />,
    { wrapper },
  );
  return { onApply };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(measurementsApi.tree).mockResolvedValue(tree);
});

describe('MeasurementPicker', () => {
  it('shows only elements of the line unit and applies the summed selection', async () => {
    const { onApply } = renderPicker({ unit: 'M2' });

    // Only M2 elements — the LINEAR one is filtered out.
    await waitFor(() => expect(screen.getByText('Стеля')).toBeTruthy());
    expect(screen.getByText('Підлога')).toBeTruthy();
    expect(screen.queryByText('Відкоси')).toBeNull();

    // i1 pre-checked (selection memory); tick i2 as well → 20 + 10 = 30.
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes[0].checked).toBe(true); // Стеля
    fireEvent.click(boxes[1]); // Підлога

    fireEvent.click(screen.getByRole('button', { name: 'Застосувати' }));
    expect(onApply).toHaveBeenCalledWith(['i1', 'i2'], 30);
  });

  it('warns when the quantity was edited by hand', async () => {
    renderPicker({ quantityManual: true });
    await waitFor(() => expect(screen.getByText(/змінена вручну/)).toBeTruthy());
  });
});
