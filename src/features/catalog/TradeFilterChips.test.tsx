import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/lib/i18n.ts';
import { TradeFilterChips, tradeMatches, customTradeKey, type TradeKey, type TradedEntity } from './TradeFilterChips.tsx';

function item(trade: TradedEntity['trade'], customTradeId: string | null = null, customTradeName: string | null = null): TradedEntity {
  return { trade, customTradeId, customTradeName };
}

const ELECTRICAL = item('ELECTRICAL');
const BUILDER = item('BUILDER');
const OTHER = item('OTHER');
const CUSTOM = item('OTHER', 'ct1', 'Натяжні стелі');

describe('tradeMatches', () => {
  it('empty selection means all trades', () => {
    expect(tradeMatches(ELECTRICAL, new Set())).toBe(true);
    expect(tradeMatches(item(null), new Set())).toBe(true);
  });

  it('matches selected trades; a null trade counts as OTHER ("Інше")', () => {
    const sel = new Set<TradeKey>(['ELECTRICAL', 'OTHER']);
    expect(tradeMatches(ELECTRICAL, sel)).toBe(true);
    expect(tradeMatches(BUILDER, sel)).toBe(false);
    expect(tradeMatches(OTHER, sel)).toBe(true);
    expect(tradeMatches(item(null), sel)).toBe(true); // null → OTHER
  });

  it('a custom-trade entity matches only its own key, never the system "Інше" chip', () => {
    const selOther = new Set<TradeKey>(['OTHER']);
    expect(tradeMatches(CUSTOM, selOther)).toBe(false); // trade=OTHER too, but must NOT match plain "Інше"

    const selCustom = new Set<TradeKey>([customTradeKey('ct1')]);
    expect(tradeMatches(CUSTOM, selCustom)).toBe(true);
    expect(tradeMatches(OTHER, selCustom)).toBe(false); // and the reverse never leaks either
  });
});

describe('TradeFilterChips — multi-select, built from real presence', () => {
  it('renders nothing when fewer than two chips would show', () => {
    const { container } = render(
      <TradeFilterChips items={[ELECTRICAL]} value={new Set()} onChange={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows a chip only for trades actually present in items — not the profile', () => {
    // Two system trades present + a custom one; a third system trade never shows even if
    // it were in the master's profile, because no item carries it.
    render(<TradeFilterChips items={[ELECTRICAL, BUILDER, CUSTOM]} value={new Set()} onChange={vi.fn()} />);

    expect(screen.getByText(/Електрика/)).toBeTruthy();
    expect(screen.getByText(/Будівельник/)).toBeTruthy();
    expect(screen.getByText(/Натяжні стелі/)).toBeTruthy();
    expect(screen.queryByText(/Сантехніка/)).toBeNull();
  });

  it('shows a single "Інше" (OTHER) chip — never two, even alongside a custom trade also stored as OTHER', () => {
    render(<TradeFilterChips items={[ELECTRICAL, OTHER, CUSTOM]} value={new Set()} onChange={vi.fn()} />);
    expect(screen.getAllByText(/Інше/)).toHaveLength(1);
    expect(screen.getByText(/Натяжні стелі/)).toBeTruthy();
  });

  it('adds a trade to the selection (others stay, not every chip is on yet)', () => {
    const onChange = vi.fn();
    render(
      <TradeFilterChips items={[ELECTRICAL, BUILDER, OTHER]} value={new Set<TradeKey>(['ELECTRICAL'])} onChange={onChange} />,
    );
    fireEvent.click(screen.getByText(/Будівельник/));
    expect(onChange).toHaveBeenCalledWith(new Set(['ELECTRICAL', 'BUILDER']));
  });

  it('toggles an already-selected trade off', () => {
    const onChange = vi.fn();
    render(
      <TradeFilterChips
        items={[ELECTRICAL, BUILDER, OTHER]}
        value={new Set<TradeKey>(['ELECTRICAL', 'BUILDER'])}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText(/Електрика/));
    expect(onChange).toHaveBeenCalledWith(new Set(['BUILDER']));
  });

  it('toggles a custom-trade chip on and off by its own key', () => {
    const onChange = vi.fn();
    render(
      <TradeFilterChips items={[ELECTRICAL, BUILDER, CUSTOM]} value={new Set<TradeKey>()} onChange={onChange} />,
    );
    fireEvent.click(screen.getByText(/Натяжні стелі/));
    expect(onChange).toHaveBeenCalledWith(new Set([customTradeKey('ct1')]));
  });

  it('collapses to "Усі трейди" once every chip is selected', () => {
    // ELECTRICAL + BUILDER on; clicking "Інше" selects all three → nothing is
    // actually filtered, so it resets to the empty (all) selection.
    const onChange = vi.fn();
    render(
      <TradeFilterChips
        items={[ELECTRICAL, BUILDER, OTHER]}
        value={new Set<TradeKey>(['ELECTRICAL', 'BUILDER'])}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText(/Інше/));
    expect(onChange).toHaveBeenCalledWith(new Set());
  });

  it('"Усі трейди" clears the selection', () => {
    const onChange = vi.fn();
    render(
      <TradeFilterChips items={[ELECTRICAL, BUILDER]} value={new Set<TradeKey>(['ELECTRICAL'])} onChange={onChange} />,
    );
    fireEvent.click(screen.getByText(/Усі трейди/));
    expect(onChange).toHaveBeenCalledWith(new Set());
  });
});
