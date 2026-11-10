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
  it('names works and materials with no quantity — never a «%» line', () => {
    const est = anEstimate({
      items: [line('w0'), line('m0', { type: 'MATERIAL' }), line('w1', { quantity: 4 }),
        line('pct', { unit: 'PERCENT', quantity: 0 })],
    });
    expect(zeroQuantityLines(est).map((i) => i.id)).toEqual(['w0', 'm0']);
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
