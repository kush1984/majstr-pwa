import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ActReceiptsSection } from './ActReceiptsSection.tsx';
import { actsApi } from '@/api/acts.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { upgradeApi } from '@/api/upgrade.ts';
import type { UserResponse, WorkActReceiptResponse } from '@/api/types.ts';

vi.mock('@/api/acts.ts', () => ({
  actsApi: {
    addReceipt: vi.fn(() => Promise.resolve({})),
    recognizeReceipt: vi.fn(() => Promise.resolve({ recognized: false, label: null, amount: null, issuedAt: null, items: [] })),
    readReceiptQr: vi.fn(() => Promise.resolve({ recognized: false, label: null, amount: null, issuedAt: null, items: [] })),
    updateReceipt: vi.fn(() => Promise.resolve({})),
    removeReceipt: vi.fn(() => Promise.resolve()),
    receiptFileUrl: (actId: string, receiptId: string) => `/api/acts/${actId}/receipts/${receiptId}/file`,
  },
}));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/api/photos.ts', () => ({ photosApi: { fetchBlobUrl: vi.fn(() => Promise.resolve('blob:receipt')) } }));
vi.mock('@/api/upgrade.ts', () => ({ upgradeApi: { click: vi.fn(() => Promise.resolve()), interest: vi.fn(() => Promise.resolve()) } }));
// The camera and the decoders are QrScanSheet's business (and its own test's) — here the sheet is
// reduced to the one thing this section cares about: a payload arriving.
vi.mock('@/components/QrScanSheet.tsx', () => ({
  QrScanSheet: ({ open, onScanned }: { open: boolean; onScanned: (p: string) => void }) =>
    open ? (
      <button type="button" onClick={() => onScanned('fn=4000123456&id=17&date=20260815&sm=690.00')}>
        scan-qr
      </button>
    ) : null,
}));

const baseMe: UserResponse = {
  id: 'u1', email: 'm@e.com', fullName: 'M', trades: [], customTrades: [], phone: '1',
  companyName: 'C', logoUrl: null, plan: 'PRO', role: 'USER', emailVerified: true,
  createdAt: '2026-01-01', consentedToPrivacyAt: '2026-01-01', acknowledgedClientDataAt: '2026-01-01',
  planExpiresAt: null, autoRenew: false, cardMask: null, trialStartedAt: null, referralCode: 'r1',
  legalName: null, taxId: null, legalAddress: null, iban: null, bankName: null, vatPayer: false,
  vatId: null, taxGroup: null, taxRate: null, docCity: null, actNumberFormat: 'PLAIN',
};

function receipt(over: Partial<WorkActReceiptResponse> = {}): WorkActReceiptResponse {
  return { id: 'r1', label: 'Епіцентр', amount: 2400, issuedAt: '2026-08-03', hasPhoto: true, itemized: false, sortOrder: 0, ...over };
}

function renderSection(
  over: Partial<Parameters<typeof ActReceiptsSection>[0]> = {},
  plan: UserResponse['plan'] = 'PRO',
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, { ...baseMe, plan });
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

  it('FREE reads the footer, but reading the item table off a PHOTO opens the upsell', async () => {
    // The gate is per MODE (master decision, 2026-08-23) — the cheap footer pass is what turns a
    // photographed slip into a receipt row, so it must keep working on FREE. Since the fiscal-QR
    // iteration it is per SOURCE too, so the gate fires on the PHOTO read, not on the tick: the
    // tick has to stay reachable on FREE or the free QR positions could never be asked for.
    vi.mocked(actsApi.recognizeReceipt).mockResolvedValue({
      recognized: true, label: 'Епіцентр', amount: 483.5, issuedAt: '2026-08-18', items: [],
    });
    const onTransferItems = vi.fn();
    renderSection({ receipts: [], onTransferItems }, 'FREE');

    fireEvent.click(screen.getByText('+ Додати чек'));
    fireEvent.click(screen.getByText('Розпізнати і перенести позиції з чека в акт'));
    // Ticking costs nothing and is not refused.
    expect((document.querySelectorAll('input[type="checkbox"]')[0] as HTMLInputElement).checked).toBe(true);
    expect(upgradeApi.click).not.toHaveBeenCalled();

    const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [file] } });

    await waitFor(() => expect(upgradeApi.click).toHaveBeenCalledWith('RECEIPT_IMPORT'));
    // The expensive pass must not be spent — the footer still is, so the row is still usable.
    expect(vi.mocked(actsApi.recognizeReceipt).mock.calls.every((c) => c[2] === false)).toBe(true);
    expect(onTransferItems).not.toHaveBeenCalled();
  });

  it('the QR route fills the receipt and, with the tick on, carries its positions on FREE too', async () => {
    // «Безкоштовно все, що дав QR» (master decision, 2026-08-23): no model runs on this path, so
    // there is nothing for a plan to gate — positions included.
    vi.mocked(actsApi.readReceiptQr).mockResolvedValue({
      recognized: true, label: 'Епіцентр', amount: 690, issuedAt: '2026-08-15',
      items: [{ name: 'Шпаклівка', unit: 'PIECE', quantity: 2, unitPrice: 345, type: 'MATERIAL', category: null, issues: [] }],
    });
    renderSection({ receipts: [] }, 'FREE');

    fireEvent.click(screen.getByText('+ Додати чек'));
    fireEvent.click(screen.getByText('Розпізнати і перенести позиції з чека в акт'));
    fireEvent.click(screen.getByText('🔳 Зчитати QR'));
    fireEvent.click(screen.getByText('scan-qr'));

    await waitFor(() =>
      expect(actsApi.readReceiptQr).toHaveBeenCalledWith('a1', 'fn=4000123456&id=17&date=20260815&sm=690.00', true));
    await screen.findByText(/Розпізнано позицій: 1/);
    expect(upgradeApi.click).not.toHaveBeenCalled();
    const amount = screen.getByText('Сума, ₴').parentElement!.querySelector('input')!;
    expect(amount.value).toBe('690');
    expect(screen.getByDisplayValue('2026-08-15')).toBeTruthy();
  });

  it('without the tick a scanned QR fills the money and the date only («так як було»)', async () => {
    // The master's rule for acts: positions are added ONLY when the checkbox is ticked. The QR
    // makes the data free, it does not change who decides what lands in the act.
    vi.mocked(actsApi.readReceiptQr).mockResolvedValue({
      recognized: true, label: 'Епіцентр', amount: 690, issuedAt: '2026-08-15', items: [],
    });
    renderSection({ receipts: [] });

    fireEvent.click(screen.getByText('+ Додати чек'));
    fireEvent.click(screen.getByText('🔳 Зчитати QR'));
    fireEvent.click(screen.getByText('scan-qr'));

    await waitFor(() =>
      expect(actsApi.readReceiptQr).toHaveBeenCalledWith('a1', 'fn=4000123456&id=17&date=20260815&sm=690.00', false));
    expect(screen.queryByText(/Розпізнано позицій/)).toBeNull();
  });

  it('a scanned QR never counts as the receipt photo — that still has to be attached', async () => {
    vi.mocked(actsApi.readReceiptQr).mockResolvedValue({
      recognized: true, label: 'Епіцентр', amount: 690, issuedAt: '2026-08-15', items: [],
    });
    renderSection({ receipts: [] });

    fireEvent.click(screen.getByText('+ Додати чек'));
    fireEvent.click(screen.getByText('🔳 Зчитати QR'));
    fireEvent.click(screen.getByText('scan-qr'));
    await waitFor(() => expect(actsApi.readReceiptQr).toHaveBeenCalled());

    // Label and amount are filled by the QR, and «Додати чек» is STILL disabled: the paper is the
    // proof, and a fiscal code is not a photograph of it.
    expect((screen.getByText('Додати чек').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/обов'язкові/)).toBeTruthy();
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
