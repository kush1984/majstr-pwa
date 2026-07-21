import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/lib/i18n.ts';
import { ElectricalPlanSheet } from './ElectricalPlanSheet.tsx';
import { electricalPlanApi } from '@/api/electricalPlan.ts';
import type { ElectricalPlanParseResponse } from '@/api/types.ts';

vi.mock('@/api/electricalPlan.ts', () => ({ electricalPlanApi: { parse: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

// Variant 2: a FLAT list of point types. The model counts symbols + reads printed heights;
// it does NOT group rooms or read sizes — the master distributes in the calculator.
const parsed: ElectricalPlanParseResponse = {
  ledStripPresent: true,
  warnings: ['легенда частково нерозбірлива'],
  points: [
    { type: 'Розетка одинарна', count: 12, heights: [300], confidence: 'high', note: null },
    { type: 'Вимикач прохідний 1 кл.', count: 3, heights: [900], confidence: 'low', note: 'символ схожий на бра' },
  ],
};

function renderSheet(onApply = vi.fn()) {
  render(<ElectricalPlanSheet open onClose={() => {}} objectId="p1" onApply={onApply} />);
  return onApply;
}

// An image goes straight to parse (a PDF would first hit the client page-picker via pdf-lib).
async function pickPlan() {
  vi.mocked(electricalPlanApi.parse).mockResolvedValue(parsed);
  const file = new File([new Uint8Array([1, 2, 3])], 'plan.png', { type: 'image/png' });
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByDisplayValue('Розетка одинарна')).toBeTruthy());
}

describe('ElectricalPlanSheet', () => {
  it('lists points flat, flags low-confidence rows, surfaces LED + warning', async () => {
    renderSheet();
    await pickPlan();

    expect(screen.getByDisplayValue('Вимикач прохідний 1 кл.')).toBeTruthy();
    expect(screen.getByText(/легенда частково нерозбірлива/)).toBeTruthy();
    expect(screen.getByText(/ЛЕД/i)).toBeTruthy();
    expect(screen.getByText(/символ схожий на бра/)).toBeTruthy();
    // 12 + 3 in the apply button.
    expect(screen.getByRole('button', { name: /15/ })).toBeTruthy();
  });

  it('apply hands the counts + seeded calculator drops (kind mapped, height read) to the section', async () => {
    const onApply = renderSheet();
    await pickPlan();

    fireEvent.change(screen.getByDisplayValue('12'), { target: { value: '14' } });
    fireEvent.click(screen.getByRole('button', { name: /17/ }));

    await waitFor(() => expect(onApply).toHaveBeenCalled());
    const arg = onApply.mock.calls[0][0];

    expect(arg.points).toEqual([
      { type: 'Розетка одинарна', count: 14, heights: [300] },
      { type: 'Вимикач прохідний 1 кл.', count: 3, heights: [900] },
    ]);
    // Seed: an explicit-length bus (0, the master sets it), each point a chased drop.
    expect(arg.seed).toEqual({
      busLevel: 2600,
      busFromTop: true,
      busLength: 0,
      busChase: true,
      reservePct: 10,
      points: [
        { kind: 'socket', h: 300, qty: 14, chase: true },
        { kind: 'switch', h: 900, qty: 3, chase: true },
      ],
    });
  });
});
