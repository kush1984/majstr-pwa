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
// Filed under TILING (whichever trade claimed the (owner, name, type, unit) slot first), but the
// same name/type/unit also ships under PAINTER per the default catalog — see
// CatalogItemResponse.sharedTrades / CatalogService.sharedTradesFor.
const SHARED_TILING_PAINTER: TradedEntity = { trade: 'TILING', customTradeId: null, customTradeName: null, sharedTrades: ['PAINTER'] };

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

  it('a position shared with another trade matches that trade too, not just its own', () => {
    expect(tradeMatches(SHARED_TILING_PAINTER, new Set<TradeKey>(['TILING']))).toBe(true);
    expect(tradeMatches(SHARED_TILING_PAINTER, new Set<TradeKey>(['PAINTER']))).toBe(true);
    expect(tradeMatches(SHARED_TILING_PAINTER, new Set<TradeKey>(['BUILDER']))).toBe(false);
    // No sharedTrades at all — behaves exactly as before, matches only its own trade.
    expect(tradeMatches(ELECTRICAL, new Set<TradeKey>(['PAINTER']))).toBe(false);
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

  it('shows a chip for a trade no item is directly tagged with, if a shared item recognizes it', () => {
    // ELECTRICAL supplies the second chip so the ">= 2 chips" rule doesn't hide everything; the
    // point under test is that PAINTER shows even though no item's OWN trade is PAINTER.
    render(<TradeFilterChips items={[ELECTRICAL, SHARED_TILING_PAINTER]} value={new Set()} onChange={vi.fn()} />);
    expect(screen.getByText(/Малярні роботи/)).toBeTruthy(); // PAINTER — no item's OWN trade, only shared
    expect(screen.getByText(/Плитка/)).toBeTruthy(); // TILING — the item's own trade
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
