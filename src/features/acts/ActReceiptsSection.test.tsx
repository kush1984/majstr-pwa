import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ActReceiptsSection } from './ActReceiptsSection.tsx';
import { actsApi } from '@/api/acts.ts';
import type { WorkActReceiptResponse } from '@/api/types.ts';

vi.mock('@/api/acts.ts', () => ({
  actsApi: {
    addReceipt: vi.fn(() => Promise.resolve({})),
    updateReceipt: vi.fn(() => Promise.resolve({})),
    removeReceipt: vi.fn(() => Promise.resolve()),
    receiptFileUrl: (actId: string, receiptId: string) => `/api/acts/${actId}/receipts/${receiptId}/file`,
  },
}));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/api/photos.ts', () => ({ photosApi: { fetchBlobUrl: vi.fn(() => Promise.resolve('blob:receipt')) } }));

function receipt(over: Partial<WorkActReceiptResponse> = {}): WorkActReceiptResponse {
  return { id: 'r1', label: 'Епіцентр', amount: 2400, issuedAt: '2026-08-03', hasPhoto: true, sortOrder: 0, ...over };
}

function renderSection(over: Partial<Parameters<typeof ActReceiptsSection>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <ActReceiptsSection actId="a1" projectId="p1" receipts={[receipt({ hasPhoto: false })]} signed={false}
      toExpenses onToExpensesChange={() => {}} {...over} />,
    { wrapper },
  );
}

beforeEach(() => vi.clearAllMocks());

describe('ActReceiptsSection', () => {
  it('adds a receipt with its photo in one multipart call', async () => {
    // The master photographs the paper and types what it cost — no line-item parsing (his own words).
    renderSection({ receipts: [] });

    fireEvent.click(screen.getByText('+ Додати чек'));
    fireEvent.change(screen.getByPlaceholderText('Епіцентр — клей і грунтовка'), {
      target: { value: 'Епіцентр' },
    });
    const amount = screen.getByText('Сума, ₴').parentElement!.querySelector('input')!;
    fireEvent.change(amount, { target: { value: '2400' } });
    const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [file] } });

    fireEvent.click(screen.getByText('Додати чек'));

    await waitFor(() => expect(actsApi.addReceipt).toHaveBeenCalled());
    expect(vi.mocked(actsApi.addReceipt).mock.calls[0][1]).toMatchObject({ label: 'Епіцентр', amount: 2400, file });
  });

  it('shows the subtotal and hides every edit affordance once the act is signed', () => {
    const { rerender } = renderSection({
      receipts: [receipt({ hasPhoto: false }), receipt({ id: 'r2', label: 'Нова Пошта', amount: 600, hasPhoto: false })],
    });

    expect(screen.getByText('Разом за чеками')).toBeTruthy();
    expect(screen.getByText('+ Додати чек')).toBeTruthy();

    rerender(
      <ActReceiptsSection actId="a1" projectId="p1" receipts={[receipt()]} signed
        toExpenses onToExpensesChange={() => {}} />,
    );
    expect(screen.queryByText('+ Додати чек')).toBeNull();
    expect(screen.queryByText('Видалити')).toBeNull();
  });

  it('deletes a receipt behind a confirmation', async () => {
    renderSection();

    fireEvent.click(screen.getByText('Видалити'));
    await screen.findByText('Видалити чек?');
    fireEvent.click(screen.getAllByText('Видалити').at(-1)!);

    await waitFor(() => expect(actsApi.removeReceipt).toHaveBeenCalledWith('a1', 'r1'));
  });
});
