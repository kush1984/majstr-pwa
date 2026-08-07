import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/lib/i18n.ts';
import { TradeSelect } from './TradeSelect.tsx';

describe('TradeSelect', () => {
  it('picking a system trade reports it with customTradeId null', () => {
    const onChange = vi.fn();
    render(<TradeSelect value={{ trade: null, customTradeId: null }} onChange={onChange} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'TILING' } });

    expect(onChange).toHaveBeenCalledWith({ trade: 'TILING', customTradeId: null });
  });

  it('picking "Загальна" reports trade null', () => {
    const onChange = vi.fn();
    render(<TradeSelect value={{ trade: 'TILING', customTradeId: null }} onChange={onChange} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'GENERAL' } });

    expect(onChange).toHaveBeenCalledWith({ trade: null, customTradeId: null });
  });

  it('offers custom trades and reports customTradeId with trade null when one is picked', () => {
    const onChange = vi.fn();
    render(
      <TradeSelect
        value={{ trade: null, customTradeId: null }}
        onChange={onChange}
        customTrades={[{ id: 'ct1', name: 'Натяжні стелі' }]}
      />,
    );

    expect(screen.getByText(/Натяжні стелі/)).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'custom:ct1' } });

    expect(onChange).toHaveBeenCalledWith({ trade: null, customTradeId: 'ct1' });
  });

  it('selects the current custom trade as the initial value', () => {
    render(
      <TradeSelect
        value={{ trade: null, customTradeId: 'ct1' }}
        onChange={vi.fn()}
        customTrades={[{ id: 'ct1', name: 'Натяжні стелі' }]}
      />,
    );

    expect(document.querySelector('select')?.value).toBe('custom:ct1');
  });
});
