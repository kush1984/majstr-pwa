import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { AddItemSheet } from './AddItemSheet.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { catalogApi } from '@/api/catalog.ts';
import { estimatesApi } from '@/api/estimates.ts';
import type { CatalogItemResponse, UserResponse } from '@/api/types.ts';

vi.mock('@/api/catalog.ts', () => ({
  catalogApi: { list: vi.fn(), create: vi.fn(), categories: vi.fn(), search: vi.fn() },
}));
vi.mock('@/api/estimates.ts', () => ({
  estimatesApi: { addItemsFromCatalogBatch: vi.fn(), addItem: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const me: UserResponse = {
  id: 'u1', email: 'm@e.com', fullName: 'M', trades: ['ELECTRICAL'], phone: '1',
  companyName: 'C', logoUrl: null, plan: 'FREE', role: 'USER', emailVerified: true,
  createdAt: '2026-01-01',
};
const catalog: CatalogItemResponse[] = [
  { id: 'i1', name: 'Розетка', category: 'Електрика', trade: 'ELECTRICAL', type: 'WORK', unit: 'PIECE', defaultPrice: 180, createdAt: '' },
  { id: 'i2', name: 'Кабель ВВГ', category: 'Кабель', trade: 'ELECTRICAL', type: 'MATERIAL', unit: 'M', defaultPrice: 38.5, createdAt: '' },
];

function renderSheet(onClose: () => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, me);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <AddItemSheet estimateId="e1" nextSortOrder={5} open onClose={onClose} />,
    { wrapper },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(catalogApi.categories).mockResolvedValue([]);
  vi.mocked(catalogApi.search).mockResolvedValue([]);
});

describe('AddItemSheet — catalog multi-select', () => {
  it('selects several catalog items and adds them in one batch request', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue(catalog);
    vi.mocked(estimatesApi.addItemsFromCatalogBatch).mockResolvedValue({
      id: 'e1', projectId: 'p1', name: null, status: 'DRAFT', validUntil: null, notes: null,
      createdAt: '', updatedAt: '', items: [], worksSubtotal: 0, materialsSubtotal: 0, total: 0,
    });
    const onClose = vi.fn();

    renderSheet(onClose);

    // Both catalog rows show; tap to select two.
    const rows = await screen.findAllByTestId('catalog-row');
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[0]);
    fireEvent.click(rows[1]);

    // The sticky "add N" button appears and triggers ONE batch call with both.
    fireEvent.click(screen.getByRole('button', { name: /Додати 2/ }));
    await waitFor(() =>
      expect(estimatesApi.addItemsFromCatalogBatch).toHaveBeenCalledWith('e1', [
        { catalogItemId: 'i1', quantity: 1, sortOrder: 5 },
        { catalogItemId: 'i2', quantity: 1, sortOrder: 6 },
      ]),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('filters the catalog list by type (works / materials)', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue(catalog);
    renderSheet(vi.fn());

    // Default: both the work and the material show.
    expect(await screen.findAllByTestId('catalog-row')).toHaveLength(2);

    // "Матеріали" → only the MATERIAL (Кабель ВВГ) remains.
    fireEvent.click(screen.getByRole('button', { name: 'Матеріали' }));
    await waitFor(() => expect(screen.getAllByTestId('catalog-row')).toHaveLength(1));
    expect(screen.getByText('Кабель ВВГ')).toBeTruthy();
    expect(screen.queryByText('Розетка')).toBeNull();

    // "Роботи" → only the WORK (Розетка) remains.
    fireEvent.click(screen.getByRole('button', { name: 'Роботи' }));
    await waitFor(() => expect(screen.getAllByTestId('catalog-row')).toHaveLength(1));
    expect(screen.getByText('Розетка')).toBeTruthy();
  });
});

describe('AddItemSheet — manual add → save-to-catalog prompt', () => {
  it('adds the line, then offers to save it to the catalog (category/price prefilled)', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue([]);
    vi.mocked(estimatesApi.addItem).mockResolvedValue({
      id: 'li1', type: 'WORK', name: 'Демонтаж розетки', category: 'Демонтаж', unit: 'PIECE',
      quantity: 2, unitPrice: 90, lineTotal: 180, sortOrder: 5,
    } as never);
    vi.mocked(catalogApi.create).mockResolvedValue({
      id: 'c9', name: 'Демонтаж розетки', category: 'Демонтаж', trade: 'OTHER', type: 'WORK',
      unit: 'PIECE', defaultPrice: 90, createdAt: '',
    } as never);
    const onClose = vi.fn();

    const { container } = renderSheet(onClose);

    fireEvent.click(screen.getByRole('button', { name: 'Вручну' }));
    fireEvent.change(container.querySelector('#it-name')!, { target: { value: 'Демонтаж розетки' } });
    fireEvent.change(container.querySelector('#it-category')!, { target: { value: 'Демонтаж' } });
    fireEvent.change(container.querySelector('#it-qty')!, { target: { value: '2' } });
    fireEvent.change(container.querySelector('#it-price')!, { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Додати' }));

    // Line added; the modal stays open showing the save-to-catalog prompt.
    await waitFor(() => expect(estimatesApi.addItem).toHaveBeenCalled());
    expect(await screen.findByText(/у ваш каталог/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    // Confirm → catalog entry with name/type/unit + the prefilled category/price.
    fireEvent.click(screen.getByRole('button', { name: 'Додати в каталог' }));
    await waitFor(() =>
      // Second arg = the client-generated UUID that makes the create idempotent on replay.
      expect(catalogApi.create).toHaveBeenCalledWith({
        name: 'Демонтаж розетки', category: 'Демонтаж', trade: 'OTHER',
        type: 'WORK', unit: 'PIECE', defaultPrice: 90,
      }, expect.any(String)),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
