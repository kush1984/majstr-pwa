import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ActReceiptsSection } from './ActReceiptsSection.tsx';
import { actsApi } from '@/api/acts.ts';
import { decodeQrFromFile } from '@/lib/qr.ts';
import type { WorkActReceiptResponse } from '@/api/types.ts';

const unread = { recognized: false, label: null, amount: null, issuedAt: null };

vi.mock('@/api/acts.ts', () => ({
  actsApi: {
    addReceipt: vi.fn(),
    recognizeStoredReceipt: vi.fn(),
    readReceiptQr: vi.fn(),
    updateReceipt: vi.fn(() => Promise.resolve({})),
    removeReceipt: vi.fn(() => Promise.resolve()),
    receiptFileUrl: (actId: string, receiptId: string) => `/api/acts/${actId}/receipts/${receiptId}/file`,
  },
}));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/api/photos.ts', () => ({
  photosApi: {
    list: vi.fn(() => Promise.resolve([])),
    fetchBlobUrl: vi.fn(() => Promise.resolve('blob:receipt')),
    fetchBlob: vi.fn(() => Promise.resolve(new Blob(['x'], { type: 'image/jpeg' }))),
  },
}));
// The camera, the canvas and jsqr are the decoder's own business (and its own test's) — here only
// the answer matters: does this photo carry a fiscal payload or not.
vi.mock('@/lib/qr.ts', async (orig) => ({
  ...(await orig<typeof import('@/lib/qr.ts')>()),
  decodeQrFromFile: vi.fn(() => Promise.resolve(null)),
}));

const FISCAL = 'https://cabinet.tax.gov.ua/cashregs/check?fn=4000123456&id=17&date=15082026%2012:00:00&sm=690.00';

function receipt(over: Partial<WorkActReceiptResponse> = {}): WorkActReceiptResponse {
  return { id: 'r1', label: 'Епіцентр', amount: 2400, returnedAmount: 0, issuedAt: '2026-08-03', hasPhoto: true, itemized: false, sortOrder: 0, ...over };
}

function renderSection(over: Partial<Parameters<typeof ActReceiptsSection>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <ActReceiptsSection actId="a1" projectId="p1" receipts={[receipt({ hasPhoto: false })]} signed={false}
      toExpenses onToExpensesChange={() => {}}
      showPhotosInPdf onShowPhotosInPdfChange={() => {}} {...over} />,
    { wrapper },
  );
}

/** Pick N photos through the gallery input and confirm the batch sheet. */
function pickAndStart(count: number, before?: () => void) {
  const files = Array.from({ length: count }, (_, i) =>
    new File(['x'], `receipt-${i}.jpg`, { type: 'image/jpeg' }));
  const gallery = document.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
  fireEvent.change(gallery, { target: { files } });
  before?.();
  fireEvent.click(screen.getByText(new RegExp(`Додати чеки: ${count}`)));
  return files;
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks keeps implementations, so every default is re-stated here — otherwise a
  // mockResolvedValue set by one test silently decides the outcome of the next one.
  vi.mocked(decodeQrFromFile).mockResolvedValue(null);
  vi.mocked(actsApi.readReceiptQr).mockResolvedValue({ ...unread });
  vi.mocked(actsApi.recognizeStoredReceipt).mockResolvedValue({ ...unread });
  vi.mocked(actsApi.addReceipt).mockImplementation((_actId, req) =>
    Promise.resolve(receipt({ id: req.id ?? 'r-new', label: 'Чек №1', amount: 0, issuedAt: null })));
});

describe('ActReceiptsSection', () => {
  it('saves every picked photo BEFORE anything is read', async () => {
    // The inversion this iteration is about: reading used to run before the row existed, so a weak
    // link did not delay a receipt — it lost it, together with the photo the master had taken.
    const order: string[] = [];
    vi.mocked(actsApi.addReceipt).mockImplementation((_actId, req) => {
      order.push('save');
      return Promise.resolve(receipt({ id: req.id ?? 'x', label: 'Чек №1', amount: 0 }));
    });
    vi.mocked(actsApi.recognizeStoredReceipt).mockImplementation(() => {
      order.push('read');
      return Promise.resolve({ ...unread });
    });
    renderSection({ receipts: [] });

    pickAndStart(3);

    await waitFor(() => expect(actsApi.recognizeStoredReceipt).toHaveBeenCalledTimes(3));
    expect(order).toEqual(['save', 'save', 'save', 'read', 'read', 'read']);
    // Amount 0 = «saved, not read yet», and each file carries its own client UUID so a retry over
    // a weak link cannot bill the same material twice.
    const calls = vi.mocked(actsApi.addReceipt).mock.calls;
    expect(calls.every((c) => c[1].amount === 0 && typeof c[1].id === 'string')).toBe(true);
    expect(new Set(calls.map((c) => c[1].id)).size).toBe(3);
  });

  it('unticking «прочитати автоматично» adds the receipts and calls no model at all', async () => {
    // The master's own report: «з недостатньою швидкістю інтернету довго думає і додавати чек не
    // хоче». This is the answer — the paper lands, the sums are typed.
    renderSection({ receipts: [] });

    pickAndStart(2, () => fireEvent.click(screen.getByText('Прочитати суми автоматично')));

    await waitFor(() => expect(actsApi.addReceipt).toHaveBeenCalledTimes(2));
    expect(actsApi.recognizeStoredReceipt).not.toHaveBeenCalled();
    expect(actsApi.updateReceipt).not.toHaveBeenCalled();
  });

  it('a fiscal QR is read locally and for free — even with the model switched off', async () => {
    // No model runs on that path, so there is nothing for the tick (or a plan) to gate.
    vi.mocked(decodeQrFromFile).mockResolvedValue(FISCAL);
    vi.mocked(actsApi.readReceiptQr).mockResolvedValue({
      recognized: true, label: 'Епіцентр', amount: 690, issuedAt: '2026-08-15',
    });
    renderSection({ receipts: [] });

    pickAndStart(1, () => fireEvent.click(screen.getByText('Прочитати суми автоматично')));

    await waitFor(() => expect(actsApi.readReceiptQr).toHaveBeenCalledWith('a1', FISCAL));
    await waitFor(() => expect(actsApi.updateReceipt).toHaveBeenCalled());
    expect(vi.mocked(actsApi.updateReceipt).mock.calls[0][2]).toMatchObject({
      amount: 690, issuedAt: '2026-08-15',
    });
    expect(actsApi.recognizeStoredReceipt).not.toHaveBeenCalled();
  });

  it('reading a receipt is free and asks for nothing but the footer', async () => {
    // The whole per-MODE gate went with the item transfer (2026-08-28): there is one read left, it
    // costs the master nothing, and it takes no mode argument left to get wrong.
    vi.mocked(actsApi.recognizeStoredReceipt).mockResolvedValue({
      recognized: true, label: 'Епіцентр', amount: 483.5, issuedAt: null,
    });
    renderSection({ receipts: [] });

    pickAndStart(1);

    // The read addresses the row the save just created — the client UUID it was given.
    await waitFor(() => expect(actsApi.recognizeStoredReceipt).toHaveBeenCalled());
    const saved = vi.mocked(actsApi.addReceipt).mock.calls[0][1].id;
    expect(vi.mocked(actsApi.recognizeStoredReceipt).mock.calls[0]).toEqual(['a1', saved]);
    await waitFor(() => expect(actsApi.updateReceipt).toHaveBeenCalled());
    expect(vi.mocked(actsApi.updateReceipt).mock.calls[0][2]).toMatchObject({ amount: 483.5 });
  });

  it('a receipt with no amount is flagged, counted and offered a re-read', async () => {
    // The master's demand verbatim: every receipt with incomplete info must say so under itself.
    renderSection({
      receipts: [receipt({ id: 'r1', amount: 0, issuedAt: null, hasPhoto: false }), receipt({ id: 'r2' })],
    });

    expect(screen.getByText(/Чеків без суми: 1/)).toBeTruthy();
    expect(screen.getByText(/Суму не прочитано/)).toBeTruthy();
    expect(screen.getByText('без суми')).toBeTruthy();

    vi.mocked(actsApi.recognizeStoredReceipt).mockResolvedValue({
      recognized: true, label: null, amount: 483.5, issuedAt: '2026-08-18',
    });
    fireEvent.click(screen.getByText('✨ Розпізнати'));

    // The stored photo is re-read: the free QR ladder first, the model only after it misses.
    await waitFor(() => expect(actsApi.recognizeStoredReceipt).toHaveBeenCalledWith('a1', 'r1'));
    await waitFor(() => expect(actsApi.updateReceipt).toHaveBeenCalled());
    expect(vi.mocked(actsApi.updateReceipt).mock.calls[0][2]).toMatchObject({
      label: 'Епіцентр', amount: 483.5, // a label the reader could not see never overwrites «Чек №N»
    });
  });

  it('numbers the rows by position while the name stays as the server gave it', async () => {
    // The ordinal follows the date order; «Чек №N» is frozen into the PDF and the doc_hash on
    // signing, so renumbering it under the master would make the signed paper disagree.
    renderSection({
      receipts: [receipt({ id: 'r1', label: 'Чек №3', issuedAt: '2026-08-20' }),
        receipt({ id: 'r2', label: 'Чек №1', issuedAt: '2026-08-02' })],
    });

    const rows = screen.getAllByText(/^Чек №\d$/).map((el) => el.closest('li')!.textContent);
    expect(rows[0]).toContain('1.');
    expect(rows[0]).toContain('Чек №3');
    expect(rows[1]).toContain('2.');
    expect(rows[1]).toContain('Чек №1');
  });

  it('the edit dialog shows the paper, and a tap opens it full-size', async () => {
    // Checking a sum a reader guessed means looking at the receipt (master feedback) — the dialog
    // used to cover the only copy of it.
    renderSection({ receipts: [receipt({ hasPhoto: true })] });

    fireEvent.click(screen.getByText('Редагувати'));
    expect(screen.getByText('Звірте суму й дату з фото чека')).toBeTruthy();

    // Two buttons carry that label — the row's thumbnail and the dialog's preview; the dialog is
    // portalled to the end of <body>, so it is the last one. It stays disabled until the bytes are
    // in: there is nothing to zoom into before that, and a click on a disabled button is silent.
    const preview = screen.getAllByRole('button', { name: 'Фото чека' }).at(-1) as HTMLButtonElement;
    await waitFor(() => expect(preview.disabled).toBe(false));
    fireEvent.click(preview);
    // Full-size on top of the sheet, so the typed values survive behind it.
    // Only the zoomed copy is labelled: the thumbnail and the preview are decorative next to
    // the fields they belong to, the full-size view is the receipt itself.
    await waitFor(() => expect(screen.getAllByAltText('Епіцентр').length).toBe(1));
    expect(screen.getByDisplayValue('2400')).toBeTruthy();
  });

  it('the re-read is disabled when it could only overwrite what is already there', () => {
    // A complete receipt has nothing left for a read to fill in, so an enabled button only offers a
    // slow call that can undo the master's own typing.
    renderSection({ receipts: [receipt({ hasPhoto: false })] });

    fireEvent.click(screen.getByText('Редагувати'));
    expect(screen.getByText('✨ Розпізнати').closest('button')!.disabled).toBe(true);
    expect(screen.getByText(/Усі дані вже заповнені/)).toBeTruthy();

    // Clear the date and it has work to do again.
    fireEvent.change(screen.getByDisplayValue('2026-08-03'), { target: { value: '' } });
    expect(screen.getByText('✨ Розпізнати').closest('button')!.disabled).toBe(false);
  });

  it('a LEGACY itemized receipt is badge-marked and excluded from «Разом за чеками»', () => {
    // Nothing creates one any more (the transfer was removed 2026-08-28), but rows frozen into an
    // already-signed act must keep reading exactly as they were signed.
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

  it('a partial return is netted off the row and the subtotal, but the paper still shows its own sum', () => {
    // «Купив цвяхів на 2000, залишилось на 500, відніс назад у магазин». The client can open the
    // photo, so hiding the 2 000 would make the billed 1 500 look like a mistake.
    renderSection({
      receipts: [receipt({ id: 'r1', label: 'Цвяхи', amount: 2000, returnedAmount: 500, hasPhoto: false })],
    });

    expect(screen.getByText(/за чеком 2 000,00.*повернуто 500,00/)).toBeTruthy();
    const subtotal = (screen.getByText('Разом за чеками').parentElement!.textContent ?? '')
      .replace(/\s+/g, ' '); // Intl groups digits with NBSP
    expect(subtotal).toContain('1 500,00');
  });

  it('the edit dialog refuses a return bigger than the receipt and shows what is left to pay', () => {
    // Mirrors the server's WORK_ACT_RECEIPT_RETURN_TOO_BIG, named while the master is looking at
    // both numbers rather than as a toast after a failed save.
    renderSection({ receipts: [receipt({ label: 'Цвяхи', amount: 2000, hasPhoto: false })] });

    fireEvent.click(screen.getByText('Редагувати'));
    const returnField = screen.getByPlaceholderText('0');
    fireEvent.change(returnField, { target: { value: '2500' } });

    expect(screen.getByText(/Повернення не може бути більшим/)).toBeTruthy();
    expect(screen.getByText('Зберегти').closest('button')!.disabled).toBe(true);

    fireEvent.change(returnField, { target: { value: '500' } });
    expect(screen.queryByText(/Повернення не може бути більшим/)).toBeNull();
    const payable = (screen.getByText('До сплати за чеком').parentElement!.textContent ?? '')
      .replace(/\s+/g, ' ');
    expect(payable).toContain('1 500,00');
  });

  it('a re-read from the card keeps a return the master already typed', async () => {
    // The request carries the whole row, so a reader that only knows label/date/total would erase
    // the one field it can never see on the paper.
    vi.mocked(actsApi.recognizeStoredReceipt).mockResolvedValue({
      recognized: true, label: 'Епіцентр', amount: 2000, issuedAt: '2026-08-05',
    });
    renderSection({
      receipts: [receipt({ id: 'r1', label: 'Цвяхи', amount: 0, returnedAmount: 300, hasPhoto: false })],
    });

    fireEvent.click(screen.getByText('✨ Розпізнати'));

    await waitFor(() => expect(actsApi.updateReceipt).toHaveBeenCalled());
    expect(vi.mocked(actsApi.updateReceipt).mock.calls[0][2].returnedAmount).toBe(300);
  });

  it('«Зберегти фото у Фото» rides every add call in the batch (default OFF)', async () => {
    renderSection({ receipts: [] });

    pickAndStart(2, () => fireEvent.click(screen.getByText('Зберегти фото чека також у розділі Фото')));

    await waitFor(() => expect(actsApi.addReceipt).toHaveBeenCalledTimes(2));
    expect(vi.mocked(actsApi.addReceipt).mock.calls.every((c) => c[1].saveToPhotos === true)).toBe(true);
  });

  it('shows the subtotal and hides every edit affordance once the act is signed', () => {
    const { rerender } = renderSection({
      receipts: [receipt({ hasPhoto: false }), receipt({ id: 'r2', label: 'Нова Пошта', amount: 600, hasPhoto: false })],
    });

    expect(screen.getByText('Разом за чеками')).toBeTruthy();
    expect(screen.getByText(/Вибрати з галереї/)).toBeTruthy();

    rerender(
      <ActReceiptsSection actId="a1" projectId="p1" receipts={[receipt()]} signed
        toExpenses onToExpensesChange={() => {}}
        showPhotosInPdf onShowPhotosInPdfChange={() => {}} />,
    );
    expect(screen.queryByText(/Вибрати з галереї/)).toBeNull();
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
