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
    recognizeReceipt: vi.fn(() => Promise.resolve({ recognized: false, label: null, amount: null, issuedAt: null, items: [] })),
    updateReceipt: vi.fn(() => Promise.resolve({})),
    removeReceipt: vi.fn(() => Promise.resolve()),
    receiptFileUrl: (actId: string, receiptId: string) => `/api/acts/${actId}/receipts/${receiptId}/file`,
  },
}));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/api/photos.ts', () => ({ photosApi: { fetchBlobUrl: vi.fn(() => Promise.resolve('blob:receipt')) } }));

function receipt(over: Partial<WorkActReceiptResponse> = {}): WorkActReceiptResponse {
  return { id: 'r1', label: 'Епіцентр', amount: 2400, issuedAt: '2026-08-03', hasPhoto: true, itemized: false, sortOrder: 0, ...over };
}

function renderSection(over: Partial<Parameters<typeof ActReceiptsSection>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <ActReceiptsSection actId="a1" projectId="p1" receipts={[receipt({ hasPhoto: false })]} signed={false}
      toExpenses onToExpensesChange={() => {}}
      showPhotosInPdf onShowPhotosInPdfChange={() => {}} onTransferItems={() => {}} {...over} />,
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
    // Recognition (mocked recognized:false) must settle before the submit re-enables.
    await waitFor(() =>
      expect((screen.getByText('Додати чек').closest('button') as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByText('Додати чек'));

    await waitFor(() => expect(actsApi.addReceipt).toHaveBeenCalled());
    expect(vi.mocked(actsApi.addReceipt).mock.calls[0][1]).toMatchObject({ label: 'Епіцентр', amount: 2400, file });
  });

  it('the photo is mandatory: without a file «Додати чек» stays disabled', () => {
    renderSection({ receipts: [] });

    fireEvent.click(screen.getByText('+ Додати чек'));
    fireEvent.change(screen.getByPlaceholderText('Епіцентр — клей і грунтовка'), {
      target: { value: 'Епіцентр' },
    });
    const amount = screen.getByText('Сума, ₴').parentElement!.querySelector('input')!;
    fireEvent.change(amount, { target: { value: '2400' } });

    const submit = screen.getByText('Додати чек').closest('button')!;
    expect(submit.disabled).toBe(true); // no photo yet
    expect(screen.getByText(/обов'язкові/)).toBeTruthy();
  });

  it('picking a photo runs recognition and prefills the amount and date, with kopecks', async () => {
    vi.mocked(actsApi.recognizeReceipt).mockResolvedValue({
      recognized: true, label: 'Епіцентр', amount: 483.5, issuedAt: '2026-08-18', items: [],
    });
    renderSection({ receipts: [] });

    fireEvent.click(screen.getByText('+ Додати чек'));
    const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [file] } });

    await waitFor(() => expect(actsApi.recognizeReceipt).toHaveBeenCalledWith('a1', file, false));
    const amount = screen.getByText('Сума, ₴').parentElement!.querySelector('input')!;
    expect(amount.value).toBe('483.5'); // kopecks survive, never rounded
    expect(screen.getByDisplayValue('Епіцентр')).toBeTruthy();
    expect(screen.getByDisplayValue('2026-08-18')).toBeTruthy();
  });

  it('an itemized receipt is badge-marked and excluded from «Разом за чеками»', () => {
    renderSection({
      receipts: [
        receipt({ id: 'r1', amount: 2400, hasPhoto: false }),
        receipt({ id: 'r2', label: 'Епіцентр (позиції)', amount: 483.5, itemized: true, hasPhoto: false }),
      ],
    });

    expect(screen.getByText('позиції цього чека включено в акт')).toBeTruthy();
    // Subtotal counts only the billed receipt: 2 400, not 2 883.50.
    const subtotal = (screen.getByText('Разом за чеками').parentElement!.textContent ?? '')
      .replace(/\s+/g, ' '); // Intl groups digits with NBSP
    expect(subtotal).toContain('2 400,00');
    expect(subtotal).not.toContain('2 883,50');
  });

  it('with «перенести позиції» the receipt lands itemized and the items go to the act', async () => {
    vi.mocked(actsApi.recognizeReceipt).mockResolvedValue({
      recognized: true, label: 'Епіцентр', amount: 483.5, issuedAt: null,
      items: [{ name: 'Клей CM-11', unit: 'PIECE', quantity: 2, unitPrice: 241.75, type: 'MATERIAL', category: null, issues: [] }],
    });
    const onTransferItems = vi.fn();
    renderSection({ receipts: [], onTransferItems });

    fireEvent.click(screen.getByText('+ Додати чек'));
    fireEvent.click(screen.getByText('Розпізнати і перенести позиції з чека в акт'));
    const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [file] } });
    await waitFor(() => expect(actsApi.recognizeReceipt).toHaveBeenCalledWith('a1', file, true));
    await screen.findByText(/Розпізнано позицій: 1/);

    fireEvent.click(screen.getByText('Додати чек'));

    await waitFor(() => expect(actsApi.addReceipt).toHaveBeenCalled());
    expect(vi.mocked(actsApi.addReceipt).mock.calls[0][1]).toMatchObject({ itemized: true });
    await waitFor(() => expect(onTransferItems).toHaveBeenCalled());
    expect(onTransferItems.mock.calls[0][0]).toHaveLength(1);
  });

  it('«Зберегти фото у Фото» rides the add call (default OFF)', async () => {
    renderSection({ receipts: [] });

    fireEvent.click(screen.getByText('+ Додати чек'));
    fireEvent.change(screen.getByPlaceholderText('Епіцентр — клей і грунтовка'), {
      target: { value: 'Епіцентр' },
    });
    const amount = screen.getByText('Сума, ₴').parentElement!.querySelector('input')!;
    fireEvent.change(amount, { target: { value: '2400' } });
    fireEvent.click(screen.getByText('Зберегти фото чека також у розділі Фото'));
    const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [file] } });
    await waitFor(() =>
      expect((screen.getByText('Додати чек').closest('button') as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByText('Додати чек'));

    await waitFor(() => expect(actsApi.addReceipt).toHaveBeenCalled());
    expect(vi.mocked(actsApi.addReceipt).mock.calls[0][1]).toMatchObject({ saveToPhotos: true });
  });

  it('shows the subtotal and hides every edit affordance once the act is signed', () => {
    const { rerender } = renderSection({
      receipts: [receipt({ hasPhoto: false }), receipt({ id: 'r2', label: 'Нова Пошта', amount: 600, hasPhoto: false })],
    });

    expect(screen.getByText('Разом за чеками')).toBeTruthy();
    expect(screen.getByText('+ Додати чек')).toBeTruthy();

    rerender(
      <ActReceiptsSection actId="a1" projectId="p1" receipts={[receipt()]} signed
        toExpenses onToExpensesChange={() => {}}
        showPhotosInPdf onShowPhotosInPdfChange={() => {}} onTransferItems={() => {}} />,
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
