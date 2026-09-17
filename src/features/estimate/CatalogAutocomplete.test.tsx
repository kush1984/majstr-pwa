import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/lib/i18n.ts';
import { CatalogAutocomplete } from './CatalogAutocomplete.tsx';
import type { CatalogItemResponse } from '@/api/types.ts';

const item: CatalogItemResponse = {
  id: 'c1',
  name: 'Шпаклювання стін',
  type: 'WORK',
  unit: 'M2',
  defaultPrice: 150,
  category: 'Малярні',
  trade: 'PAINTER',
  customTradeId: null,
  customTradeName: null,
  description: null,
  sortOrder: 0,
  sharedTrades: [],
  categoryOrder: null,
  createdAt: '2026-09-16T08:00:00Z',
};

vi.mock('@/features/catalog/useCatalog.ts', () => ({
  useCatalogSearch: () => ({ isSuccess: true, isFetching: false, data: [item] }),
  useCatalog: () => ({ data: [item] }),
}));

function renderField(onPick = vi.fn()) {
  render(
    <CatalogAutocomplete value="шпак" onChange={() => undefined} onPick={onPick} />,
  );
  fireEvent.focus(screen.getByRole('combobox'));
  return onPick;
}

/**
 * The suggestion row used to act on `onMouseDown` + `preventDefault()` for EVERY pointer. On a
 * phone `mousedown` is not a press: it is a compatibility event the browser synthesises after the
 * touch has ended and drops whenever it reads the gesture as something else — and cancelling it
 * cancelled the `click` that would have been the fallback. The result was a row that ignored taps,
 * which is the shape of the complaint that started this ("з 5-того разу спрацювало").
 */
describe('CatalogAutocomplete — picking a suggestion', () => {
  beforeEach(() => vi.clearAllMocks());

  it('picks on a finger tap, which arrives as a plain click', () => {
    const onPick = renderField();
    const row = screen.getByRole('button', { name: /Шпаклювання стін/ });

    // What a touch actually delivers: a pointerdown that is NOT a mouse, then a click.
    fireEvent.pointerDown(row, { pointerType: 'touch' });
    expect(onPick).not.toHaveBeenCalled(); // still just a finger down — he may be scrolling the list

    fireEvent.click(row);
    expect(onPick).toHaveBeenCalledWith(item);
  });

  it('still picks on the mouse press, before the input blur can close the list', () => {
    const onPick = renderField();
    const row = screen.getByRole('button', { name: /Шпаклювання стін/ });

    const evt = fireEvent.pointerDown(row, { pointerType: 'mouse' });

    expect(onPick).toHaveBeenCalledWith(item);
    expect(evt).toBe(false); // defaultPrevented — the input keeps focus
  });

  it('does not pick while the list is being dragged to read it', () => {
    const onPick = renderField();
    const row = screen.getByRole('button', { name: /Шпаклювання стін/ });

    // A scroll: the finger goes down and leaves again without the browser ever firing a click.
    fireEvent.pointerDown(row, { pointerType: 'touch' });
    fireEvent.pointerUp(row, { pointerType: 'touch' });

    expect(onPick).not.toHaveBeenCalled();
  });
});
