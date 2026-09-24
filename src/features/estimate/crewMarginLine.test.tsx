import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/lib/i18n.ts';
import { CrewMarginLine } from './EstimateEditorPage.tsx';
import type { EstimateResponse } from '@/api/types.ts';

vi.mock('@/lib/posthog.ts', () => ({ track: vi.fn() }));

function estimate(over: Partial<EstimateResponse> = {}): EstimateResponse {
  return {
    id: 'e1', projectId: 'p1', name: null, status: 'DRAFT', validUntil: null, notes: null,
    createdAt: '', updatedAt: '',
    items: [{
      id: 'i1', type: 'WORK', name: 'Штукатурка', category: null, unit: 'M2',
      quantity: 100, unitPrice: 300, lineTotal: 30000, sortOrder: 0,
      measurementRefs: [], quantityManual: false, percentBaseKind: null,
      percentBaseItemId: null, baseDetached: false, baseOriginLabel: null,
      closedByActs: null, sourceUnitPrice: 200,
    }],
    worksSubtotal: 30000, materialsSubtotal: 0, total: 30000, balance: 30000,
    crewMargin: { crewTotal: 0, margin: 0, marginAccepted: 0, unpricedCount: 0, unpricedTotal: 0 },
    ...over,
  };
}

const wrap = (node: ReactNode) => render(<>{node}</>);

/** Money is formatted with non-breaking thousands separators, so compare on the digits alone. */
const digitsOf = (s: string) => [...s].filter((c) => /[0-9+-]/.test(c)).join('');

/**
 * The editor half of «Твоя націнка» — the бригадир sees what the copy leaves him BEFORE he sends
 * it. Rendering it at all is half the test: the figure is recomputed on every render from the
 * lines, so a mistake here is an infinite render, not a wrong number.
 */
describe('CrewMarginLine', () => {
  it('shows the crew total and the margin, recomputed from the lines on screen', () => {
    wrap(<CrewMarginLine est={estimate()} />);

    const line = screen.getByTestId('crew-margin-line').textContent ?? '';
    expect(line).toContain('Бригаді');
    expect(line).toContain('Твоя націнка');
    // 100 × 200 = 20 000 to the crew; 30 000 − 20 000 = +10 000 left.
    expect(digitsOf(line)).toContain('20000');
    expect(digitsOf(line)).toContain('+10000');
  });

  /** Eligibility is the server's call — no figure from it means this is not a markup copy. */
  it('renders nothing on an ordinary estimate', () => {
    const { container } = wrap(<CrewMarginLine est={estimate({ crewMargin: null })} />);

    expect(container.textContent).toBe('');
  });
});
