import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { CatalogUpdateNotice } from './CatalogUpdateNotice.tsx';
import { catalogApi } from '@/api/catalog.ts';
import type { CatalogUpdateNoticeResponse } from '@/api/types.ts';

vi.mock('@/api/catalog.ts', () => ({
  catalogApi: {
    updateNotices: vi.fn(),
    dismissUpdateNotice: vi.fn(),
    acceptUpdateNotice: vi.fn(),
  },
}));

beforeEach(() => vi.clearAllMocks());

function renderNotice() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  render(<CatalogUpdateNotice />, { wrapper });
}

const countNotice: CatalogUpdateNoticeResponse = {
  id: 'n1', kind: 'COUNT', added: 5, removed: 2,
  positionName: null, oldPrice: null, newPrice: null,
};

const priceDriftNotice: CatalogUpdateNoticeResponse = {
  id: 'n2', kind: 'PRICE_DRIFT', added: 0, removed: 0,
  positionName: 'Штукатурка стін', oldPrice: 200, newPrice: 250,
};

describe('CatalogUpdateNotice', () => {
  it('renders nothing when the queue is empty', async () => {
    vi.mocked(catalogApi.updateNotices).mockResolvedValue([]);
    renderNotice();

    await waitFor(() => expect(catalogApi.updateNotices).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a COUNT notice with the added/removed counts, and OK dismisses it', async () => {
    vi.mocked(catalogApi.updateNotices).mockResolvedValue([countNotice]);
    vi.mocked(catalogApi.dismissUpdateNotice).mockResolvedValue(undefined);
    renderNotice();

    await waitFor(() => expect(screen.getByText('Ваш каталог оновлено')).toBeTruthy());
    expect(screen.getByText('Додано 5 позицій')).toBeTruthy();
    expect(screen.getByText('Прибрано 2 застарілих')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Зрозуміло' }));
    await waitFor(() => expect(catalogApi.dismissUpdateNotice).toHaveBeenCalledWith('n1'));
  });

  it('shows a PRICE_DRIFT notice with the old->new price and two real choices', async () => {
    vi.mocked(catalogApi.updateNotices).mockResolvedValue([priceDriftNotice]);
    renderNotice();

    await waitFor(() => expect(screen.getByText('Ринкова ціна змінилась')).toBeTruthy());
    expect(screen.getByText(/Штукатурка стін/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Оновити мою ціну' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Лишити як є' })).toBeTruthy();
  });

  it('accepting a price-drift notice calls acceptUpdateNotice, not dismiss', async () => {
    vi.mocked(catalogApi.updateNotices).mockResolvedValue([priceDriftNotice]);
    vi.mocked(catalogApi.acceptUpdateNotice).mockResolvedValue(undefined);
    renderNotice();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Оновити мою ціну' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Оновити мою ціну' }));

    await waitFor(() => expect(catalogApi.acceptUpdateNotice).toHaveBeenCalledWith('n2'));
    expect(catalogApi.dismissUpdateNotice).not.toHaveBeenCalled();
  });

  it('declining a price-drift notice dismisses it without accepting', async () => {
    vi.mocked(catalogApi.updateNotices).mockResolvedValue([priceDriftNotice]);
    vi.mocked(catalogApi.dismissUpdateNotice).mockResolvedValue(undefined);
    renderNotice();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Лишити як є' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Лишити як є' }));

    await waitFor(() => expect(catalogApi.dismissUpdateNotice).toHaveBeenCalledWith('n2'));
    expect(catalogApi.acceptUpdateNotice).not.toHaveBeenCalled();
  });

  it('is a real queue: resolving the oldest notice reveals the next one', async () => {
    vi.mocked(catalogApi.updateNotices).mockResolvedValue([countNotice, priceDriftNotice]);
    vi.mocked(catalogApi.dismissUpdateNotice).mockResolvedValue(undefined);
    renderNotice();

    await waitFor(() => expect(screen.getByText('Ваш каталог оновлено')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Зрозуміло' }));

    // Optimistic removal drops n1 from the cached list immediately — n2 (price-drift) shows next,
    // no second network round-trip needed to reveal it.
    await waitFor(() => expect(screen.getByText('Ринкова ціна змінилась')).toBeTruthy());
  });
});
