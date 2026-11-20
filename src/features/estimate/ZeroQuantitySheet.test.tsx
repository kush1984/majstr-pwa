import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/lib/i18n.ts';
import { ZeroQuantitySheet, zeroQuantityLines } from './ZeroQuantitySheet.tsx';
import { anEstimate } from '@/test/factories.ts';
import type { EstimateItemResponse } from '@/api/types.ts';

function line(id: string, over: Partial<EstimateItemResponse> = {}): EstimateItemResponse {
  return {
    id, type: 'WORK', name: id, category: null, unit: 'M2', quantity: 0, unitPrice: 100, lineTotal: 0,
    sortOrder: 0, measurementRefs: [], quantityManual: false, percentBaseKind: null, percentBaseItemId: null,
    baseDetached: false, baseOriginLabel: null, closedByActs: null, ...over,
  };
}

describe('zeroQuantityLines', () => {
  it('names works and materials with no quantity', () => {
    const est = anEstimate({
      items: [line('w0'), line('m0', { type: 'MATERIAL' }), line('w1', { quantity: 4 })],
    });
    expect(zeroQuantityLines(est).map((i) => i.id)).toEqual(['w0', 'm0']);
  });

  it('names a «%» line still unset — no percentage, or no base — and never a finished one', () => {
    // A «%» position arrives from the catalog empty (2026-11-20): the client would see it as 0 ₴.
    const pct = (id: string, over: Partial<EstimateItemResponse>) =>
      line(id, { unit: 'PERCENT', unitPrice: 0, percentBaseKind: 'POSITION', ...over });
    const est = anEstimate({
      items: [
        line('base', { quantity: 10, lineTotal: 1000 }),
        pct('noPct', { quantity: 0 }),
        pct('noBase', { quantity: 5, baseDetached: true }),
        pct('done', { quantity: 5, percentBaseItemId: 'base', lineTotal: 50 }),
        pct('baseGone', { quantity: 5, baseDetached: true, lineTotal: 50 }),
        pct('ofTotal', { quantity: 5, percentBaseKind: 'TOTAL', lineTotal: 50 }),
      ],
    });
    expect(zeroQuantityLines(est).map((i) => i.id)).toEqual(['noPct', 'noBase']);
  });

  it('asks nothing about a signed estimate or an ADDENDUM — neither can lose lines', () => {
    expect(zeroQuantityLines(anEstimate({ status: 'SIGNED', items: [line('w0')] }))).toEqual([]);
    expect(zeroQuantityLines(anEstimate({ kind: 'ADDENDUM', items: [line('w0')] }))).toEqual([]);
  });
});

describe('ZeroQuantitySheet', () => {
  it('says what the client would see, and offers both answers', () => {
    const onRemove = vi.fn();
    const onKeep = vi.fn();
    render(<ZeroQuantitySheet open count={5} removing={false} onRemove={onRemove} onKeep={onKeep} onClose={vi.fn()} />);

    expect(screen.getByText('5 позицій без кількості — клієнт побачить їх як 0 ₴')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Прибрати й продовжити' }));
    expect(onRemove).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Залишити як є' }));
    expect(onKeep).toHaveBeenCalledOnce();
  });
});
