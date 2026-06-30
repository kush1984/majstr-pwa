import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/lib/i18n.ts';
import { TradeFilterChips, tradeMatches, type TradeKey } from './TradeFilterChips.tsx';
import type { Trade } from '@/api/types.ts';

const TRADES: Trade[] = ['ELECTRICAL', 'BUILDER'];

function setup(value: Set<TradeKey>, hasOther = true) {
  const onChange = vi.fn();
  render(
    <TradeFilterChips userTrades={TRADES} hasOther={hasOther} value={value} onChange={onChange} />,
  );
  return onChange;
}

describe('tradeMatches', () => {
  it('empty selection means all trades', () => {
    expect(tradeMatches('ELECTRICAL', new Set())).toBe(true);
    expect(tradeMatches(null, new Set())).toBe(true);
  });

  it('matches selected trades; a null trade counts as OTHER ("Інше")', () => {
    const sel = new Set<TradeKey>(['ELECTRICAL', 'OTHER']);
    expect(tradeMatches('ELECTRICAL', sel)).toBe(true);
    expect(tradeMatches('BUILDER', sel)).toBe(false);
    expect(tradeMatches('OTHER', sel)).toBe(true);
    expect(tradeMatches(null, sel)).toBe(true); // null → OTHER
  });
});

describe('TradeFilterChips — multi-select', () => {
  it('renders nothing when fewer than two chips would show', () => {
    const { container } = render(
      <TradeFilterChips
        userTrades={['ELECTRICAL']}
        hasOther={false}
        value={new Set()}
        onChange={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows a single "Інше" (OTHER) chip — never two', () => {
    setup(new Set<TradeKey>());
    expect(screen.getAllByText(/Інше/)).toHaveLength(1);
  });

  it('adds a trade to the selection (others stay)', () => {
    const onChange = setup(new Set<TradeKey>(['ELECTRICAL']));
    fireEvent.click(screen.getByText(/Будівельник/));
    expect(onChange).toHaveBeenCalledWith(new Set(['ELECTRICAL', 'BUILDER']));
  });

  it('toggles an already-selected trade off', () => {
    const onChange = setup(new Set<TradeKey>(['ELECTRICAL', 'BUILDER']));
    fireEvent.click(screen.getByText(/Електрика/));
    expect(onChange).toHaveBeenCalledWith(new Set(['BUILDER']));
  });

  it('collapses to "Усі трейди" once every chip is selected', () => {
    // ELECTRICAL + BUILDER on; clicking "Інше" selects all three → nothing is
    // actually filtered, so it resets to the empty (all) selection.
    const onChange = setup(new Set<TradeKey>(['ELECTRICAL', 'BUILDER']));
    fireEvent.click(screen.getByText(/Інше/));
    expect(onChange).toHaveBeenCalledWith(new Set());
  });

  it('"Усі трейди" clears the selection', () => {
    const onChange = setup(new Set<TradeKey>(['ELECTRICAL']));
    fireEvent.click(screen.getByText(/Усі трейди/));
    expect(onChange).toHaveBeenCalledWith(new Set());
  });
});
