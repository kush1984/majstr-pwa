import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/lib/i18n.ts';
import { TradeFilterChips, tradeMatches, type TradeKey } from './TradeFilterChips.tsx';
import type { Trade } from '@/api/types.ts';

const TRADES: Trade[] = ['ELECTRICAL', 'BUILDER'];

function setup(value: Set<TradeKey>, hasUntagged = true) {
  const onChange = vi.fn();
  render(
    <TradeFilterChips
      userTrades={TRADES}
      hasUntagged={hasUntagged}
      value={value}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe('tradeMatches', () => {
  it('empty selection means all trades', () => {
    expect(tradeMatches('ELECTRICAL', new Set())).toBe(true);
    expect(tradeMatches(null, new Set())).toBe(true);
  });

  it('matches the selected trades and NULL for untagged', () => {
    const sel = new Set<TradeKey>(['ELECTRICAL', 'NULL']);
    expect(tradeMatches('ELECTRICAL', sel)).toBe(true);
    expect(tradeMatches('BUILDER', sel)).toBe(false);
    expect(tradeMatches(null, sel)).toBe(true); // untagged → 'NULL'
  });
});

describe('TradeFilterChips — multi-select', () => {
  it('renders nothing for a single-trade master', () => {
    const { container } = render(
      <TradeFilterChips
        userTrades={['ELECTRICAL']}
        hasUntagged
        value={new Set()}
        onChange={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
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
    // ELECTRICAL + BUILDER already on; clicking "Інше" would select all three →
    // nothing is actually filtered, so it resets to the empty (all) selection.
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
