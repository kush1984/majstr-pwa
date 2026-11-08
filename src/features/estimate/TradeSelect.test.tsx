import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/lib/i18n.ts';
import { TradeSelect } from './TradeSelect.tsx';

describe('TradeSelect', () => {
  it('picking a system trade reports it with customTradeId null', () => {
    const onChange = vi.fn();
    render(<TradeSelect value={{ trade: null, customTradeId: null }} onChange={onChange} trades={['TILING']} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'TILING' } });

    expect(onChange).toHaveBeenCalledWith({ trade: 'TILING', customTradeId: null });
  });

  it('picking "Загальна" reports trade null', () => {
    const onChange = vi.fn();
    render(<TradeSelect value={{ trade: 'TILING', customTradeId: null }} onChange={onChange} trades={['TILING']} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'GENERAL' } });

    expect(onChange).toHaveBeenCalledWith({ trade: null, customTradeId: null });
  });

  it('offers custom trades and reports customTradeId with trade null when one is picked', () => {
    const onChange = vi.fn();
    render(
      <TradeSelect
        value={{ trade: null, customTradeId: null }}
        onChange={onChange}
        trades={[]}
        customTrades={[{ id: 'ct1', name: 'Натяжні стелі' }]}
      />,
    );

    expect(screen.getByText(/Натяжні стелі/)).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'custom:ct1' } });

    expect(onChange).toHaveBeenCalledWith({ trade: null, customTradeId: 'ct1' });
  });

  it('offers only the trades in his profile, and keeps the current filing even when it is not one', () => {
    render(
      <TradeSelect value={{ trade: 'ELECTRICAL', customTradeId: null }} onChange={vi.fn()} trades={['TILING', 'FLOORING']} />,
    );

    const offered = Array.from(document.querySelector('select')?.options ?? []).map((o) => o.value);
    expect(offered).toEqual(['ELECTRICAL', 'TILING', 'FLOORING', 'GENERAL']);
    expect(document.querySelector('select')?.value).toBe('ELECTRICAL');
  });

  it('selects the current custom trade as the initial value', () => {
    render(
      <TradeSelect
        value={{ trade: null, customTradeId: 'ct1' }}
        onChange={vi.fn()}
        trades={[]}
        customTrades={[{ id: 'ct1', name: 'Натяжні стелі' }]}
      />,
    );

    expect(document.querySelector('select')?.value).toBe('custom:ct1');
  });
});
