import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/lib/i18n.ts';
import { CatalogPage } from './CatalogPage.tsx';
import { catalogApi } from '@/api/catalog.ts';
import type { CatalogItemResponse } from '@/api/types.ts';

vi.mock('@/api/catalog.ts', () => ({
  catalogApi: { list: vi.fn(), categories: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const LONG = 'Профіль/куточок для плитки алюмінієвий 10 мм полірований';

const item: CatalogItemResponse = {
  id: 'c1', name: LONG, category: 'Плитка', trade: 'TILING',
  type: 'MATERIAL', unit: 'PIECE', defaultPrice: 220, createdAt: '',
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter><QueryClientProvider client={qc}>{children}</QueryClientProvider></MemoryRouter>
  );
  return render(<CatalogPage />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(catalogApi.categories).mockResolvedValue([]);
});

describe('CatalogPage — long position names', () => {
  it('wraps a long name instead of cutting it off', async () => {
    // Reported from a real phone: catalog names are long and specific, and the TAIL is what
    // tells two positions apart («…алюмінієвий 10 мм» vs «…пластиковий»). Truncating left the
    // master tapping rows they could not read. Same treatment the template rows already had.
    //
    // jsdom does no layout, so this asserts the mechanism rather than pixels: the full text is
    // present and the element is not clipped to one line. That is enough to catch the actual
    // regression — someone putting `truncate` back.
    vi.mocked(catalogApi.list).mockResolvedValue([item]);

    renderPage();

    const name = await screen.findByText(LONG);
    await waitFor(() => expect(name).toBeTruthy());
    expect(name.className).toContain('break-words');
    expect(name.className).not.toContain('truncate');
  });
});
