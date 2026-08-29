import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ReceiptImportSheet } from './ReceiptImportSheet.tsx';
import { receiptImportApi } from '@/api/receiptImport.ts';
import { photosApi } from '@/api/photos.ts';
import { economyApi } from '@/api/economy.ts';
import { upgradeApi } from '@/api/upgrade.ts';
import { decodeQrFromFile } from '@/lib/qr.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { PLAN_LIMITS_KEY } from '@/features/plan/usePlanLimits.ts';
import type { ItemType, Unit, UserResponse } from '@/api/types.ts';

vi.mock('@/api/receiptImport.ts', () => ({
  receiptImportApi: { parse: vi.fn(), parseQr: vi.fn(), commit: vi.fn() },
}));
vi.mock('@/api/upgrade.ts', () => ({
  upgradeApi: { click: vi.fn(), interest: vi.fn() },
}));
vi.mock('@/api/photos.ts', () => ({ photosApi: { upload: vi.fn(), list: vi.fn() } }));
vi.mock('@/api/economy.ts', () => ({ economyApi: { addExpense: vi.fn() } }));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
// The camera and the decoding ladder are qr.test.ts's business; here only the payload matters —
// but `looksFiscal` stays REAL, because "is this the fiscal code or the shop's loyalty one" is
// exactly the decision this sheet delegates to it.
vi.mock('@/lib/qr.ts', async (orig) => ({
  ...(await orig<typeof import('@/lib/qr.ts')>()),
  decodeQrFromFile: vi.fn(),
}));

const FISCAL =
  'https://cabinet.tax.gov.ua/cashregs/check?fn=4000123456&id=17&date=15082026%2012:00:00&sm=690.00';

const baseMe: UserResponse = {
  id: 'u1', email: 'm@e.com', fullName: 'M', trades: [], customTrades: [], phone: '1',
  companyName: 'C', logoUrl: null, plan: 'PRO', role: 'USER', emailVerified: true,
  createdAt: '2026-01-01', consentedToPrivacyAt: '2026-01-01', acknowledgedClientDataAt: '2026-01-01',
  planExpiresAt: null, autoRenew: false, cardMask: null, trialStartedAt: null, referralCode: 'r1',
  legalName: null, taxId: null, legalAddress: null, iban: null, bankName: null, vatPayer: false,
  vatId: null, taxGroup: null, taxRate: null, docCity: null, actNumberFormat: 'PLAIN',
};

function item(name: string, unitPrice: number, quantity = 1) {
  return {
    name, unit: 'PIECE' as Unit, quantity, unitPrice,
    type: 'MATERIAL' as ItemType, category: null, issues: [],
  };
}

function estimate(total: number) {
  return {
    id: 'e1', projectId: 'p1', name: null, status: 'DRAFT' as const, validUntil: null, notes: null,
    createdAt: '', updatedAt: '', items: [], worksSubtotal: 0, materialsSubtotal: total, total,
    depositAmount: null, balance: total,
  };
}

function renderSheet(
  plan: UserResponse['plan'] = 'PRO',
  gallery?: { cap: number; used: number },
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, { ...baseMe, plan });
  if (gallery) {
    qc.setQueryData(PLAN_LIMITS_KEY, {
      plan, maxProjects: null, projectsUsed: 0, maxEstimatesPerProject: null,
      maxPhotosPerObject: null, maxReceiptPhotosPerObject: gallery.cap,
    });
    vi.mocked(photosApi.list).mockResolvedValue(
      Array.from({ length: gallery.used }, (_, i) => ({
        id: `ph-${i}`, source: 'RECEIPT' as const, visibility: 'PRIVATE' as const,
        fileUrl: `/api/files/ph-${i}`, createdAt: '2026-08-25T10:00:00Z',
      })),
    );
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <ReceiptImportSheet open onClose={() => {}} estimateId="e1" projectId="p1" />,
    { wrapper },
  );
}

/** Fire the gallery input (the last one — the first is the camera). */
function pick(files: File[]) {
  const inputs = document.querySelectorAll('input[type="file"]');
  fireEvent.change(inputs[inputs.length - 1], { target: { files } });
}

function photos(n: number): File[] {
  return Array.from({ length: n }, (_, i) =>
    new File(['x'], `receipt-${i}.jpg`, { type: 'image/jpeg' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks wipes calls, NOT implementations — so every default is re-stated here, or a
  // mockResolvedValue left by one test silently decides the next one's outcome.
  vi.mocked(decodeQrFromFile).mockResolvedValue(null);
  vi.mocked(receiptImportApi.parse).mockResolvedValue({ items: [], depositAmount: null });
  vi.mocked(receiptImportApi.parseQr).mockResolvedValue({ items: [], depositAmount: null });
  vi.mocked(receiptImportApi.commit).mockResolvedValue(estimate(0));
  vi.mocked(upgradeApi.click).mockResolvedValue(undefined);
  vi.mocked(economyApi.addExpense).mockResolvedValue(undefined as never);
  vi.mocked(photosApi.upload).mockResolvedValue(undefined as never);
  vi.mocked(photosApi.list).mockResolvedValue([]);
});

describe('ReceiptImportSheet — a pile of receipts in one gesture', () => {
  it('runs the QR rung per photo and only falls through to the model where there was no code', async () => {
    const files = photos(2);
    vi.mocked(decodeQrFromFile).mockImplementation((f: File) =>
      Promise.resolve(f === files[0] ? FISCAL : null));
    vi.mocked(receiptImportApi.parseQr).mockResolvedValue({
      items: [item('Шпаклівка', 345, 2)], depositAmount: null,
    });
    vi.mocked(receiptImportApi.parse).mockResolvedValue({
      items: [item('Цемент М500', 180, 2)], depositAmount: null,
    });

    renderSheet();
    pick(files);

    await waitFor(() => expect(screen.getByDisplayValue('Шпаклівка')).toBeTruthy());
    expect(screen.getByDisplayValue('Цемент М500')).toBeTruthy();
    // The paid read ran ONCE — on the slip whose code could not be decoded.
    expect(receiptImportApi.parse).toHaveBeenCalledTimes(1);
    expect(receiptImportApi.parse).toHaveBeenCalledWith('e1', files[1]);
    expect(receiptImportApi.parseQr).toHaveBeenCalledWith('e1', FISCAL);

    // One review, but each row still says which slip it came from and how it was read.
    expect(screen.getByText(/Чек 1 · з QR-коду/)).toBeTruthy();
    expect(screen.getByText(/Чек 2 · з фото/)).toBeTruthy();
  });

  it('shows the paper beside each slip and numbers the rows within it', async () => {
    const files = photos(2);
    vi.mocked(decodeQrFromFile).mockResolvedValue(null);
    vi.mocked(receiptImportApi.parse).mockImplementation((_id: string, f: File) =>
      Promise.resolve(
        f === files[0]
          ? { items: [item('Цемент М500', 180, 2), item('Пісок', 90)], depositAmount: null }
          : { items: [item('Ґрунтовка', 250)], depositAmount: null },
      ));

    renderSheet();
    pick(files);
    await waitFor(() => expect(screen.getByDisplayValue('Цемент М500')).toBeTruthy());

    // The ordinal restarts on the second slip — it numbers the positions ON that receipt, which is
    // what the master can check against the paper he is holding.
    expect(screen.getAllByText(/^\d\.$/).map((el) => el.textContent)).toEqual(['1.', '2.', '1.']);

    // Same shared control as the act's receipts: a tap opens the picked photo full-size, so the
    // values can be checked against the slip without leaving the review.
    const thumbs = screen.getAllByRole('button', { name: 'Фото чека' });
    expect(thumbs.length).toBe(2);
    // The thumbnail stays disabled until its object URL is in — there is nothing to zoom into
    // before that, and a click on a disabled button is silently dropped.
    await waitFor(() => expect((thumbs[1] as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(thumbs[1]);
    expect(screen.getByAltText('Чек 2')).toBeTruthy();
  });

  it('appends every reviewed line from every receipt in one commit', async () => {
    const files = photos(2);
    vi.mocked(decodeQrFromFile).mockImplementation((f: File) =>
      Promise.resolve(f === files[0] ? FISCAL : null));
    vi.mocked(receiptImportApi.parseQr).mockResolvedValue({
      items: [item('Шпаклівка', 345, 2)], depositAmount: null,
    });
    vi.mocked(receiptImportApi.parse).mockResolvedValue({
      items: [item('Цемент М500', 180, 2)], depositAmount: null,
    });
    vi.mocked(receiptImportApi.commit).mockResolvedValue(estimate(1050));

    renderSheet();
    pick(files);
    await waitFor(() => expect(screen.getByDisplayValue('Цемент М500')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Додати 2/i }));

    await waitFor(() =>
      expect(receiptImportApi.commit).toHaveBeenCalledWith('e1', [
        { name: 'Шпаклівка', unit: 'PIECE', quantity: 2, unitPrice: 345, type: 'MATERIAL', category: null },
        { name: 'Цемент М500', unit: 'PIECE', quantity: 2, unitPrice: 180, type: 'MATERIAL', category: null },
      ]),
    );
  });

  it('keeps every picked photo — one expense, then the whole pile into «Чеки»', async () => {
    const files = photos(2);
    vi.mocked(receiptImportApi.parse).mockResolvedValue({
      items: [item('Цемент М500', 180, 1)], depositAmount: null,
    });
    vi.mocked(receiptImportApi.commit).mockResolvedValue(estimate(360));

    renderSheet();
    pick(files);
    await waitFor(() => expect(screen.getAllByDisplayValue('Цемент М500')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: /Додати 2/i }));

    // The money was spent either way — one expense for the whole pile (2 × 180).
    await waitFor(() => expect(screen.getByText(/Записати у витрати/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Записати$/ }));
    await waitFor(() =>
      expect(economyApi.addExpense).toHaveBeenCalledWith(
        'p1', expect.objectContaining({ amount: 360, category: 'MATERIALS' })));

    // Then the paper itself: every photo, not just the first.
    await waitFor(() => expect(screen.getByText(/Зберегти фото чеків/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Зберегти$/ }));
    await waitFor(() => expect(photosApi.upload).toHaveBeenCalledTimes(2));
    expect(photosApi.upload).toHaveBeenCalledWith(
      'p1', files[0], { source: 'RECEIPT', estimateId: 'e1' });
    expect(photosApi.upload).toHaveBeenCalledWith(
      'p1', files[1], { source: 'RECEIPT', estimateId: 'e1' });
  });

  it('a photo that fails to save never stops the rest of the pile', async () => {
    // On FREE the object's receipt-photo cap is reachable mid-pile: «сім збереглося, восьме ні».
    const files = photos(2);
    vi.mocked(receiptImportApi.parse).mockResolvedValue({
      items: [item('Цемент М500', 180, 1)], depositAmount: null,
    });
    vi.mocked(photosApi.upload)
      .mockRejectedValueOnce(new Error('cap'))
      .mockResolvedValue(undefined as never);

    renderSheet();
    pick(files);
    await waitFor(() => expect(screen.getAllByDisplayValue('Цемент М500')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: /Додати 2/i }));
    await waitFor(() => expect(screen.getByText(/Записати у витрати/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Записати$/ }));

    await waitFor(() => expect(screen.getByText(/Зберегти фото чеків/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Зберегти$/ }));
    await waitFor(() => expect(photosApi.upload).toHaveBeenCalledTimes(2));
  });

  it('says how many photos fit BEFORE uploading, and saves only those', async () => {
    // The object's receipt-photo budget is separate and small on FREE (5). The pile is checked
    // against what is left, so it never turns into a run of per-file failures.
    vi.mocked(decodeQrFromFile).mockResolvedValue(FISCAL);
    vi.mocked(receiptImportApi.parseQr).mockResolvedValue({
      items: [item('Шпаклівка', 345, 1)], depositAmount: null,
    });

    renderSheet('FREE', { cap: 5, used: 4 });
    pick(photos(3));
    await waitFor(() => expect(screen.getAllByDisplayValue('Шпаклівка')).toHaveLength(3));

    fireEvent.click(screen.getByRole('button', { name: /Додати 3/i }));
    await waitFor(() => expect(screen.getByText(/Записати у витрати/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Записати$/ }));

    await waitFor(() => expect(screen.getByText(/Збережу перші 1 з 3/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Зберегти$/ }));
    await waitFor(() => expect(photosApi.upload).toHaveBeenCalledTimes(1));
  });

  it('with no room left it does not offer to save at all', async () => {
    vi.mocked(decodeQrFromFile).mockResolvedValue(FISCAL);
    vi.mocked(receiptImportApi.parseQr).mockResolvedValue({
      items: [item('Шпаклівка', 345, 1)], depositAmount: null,
    });

    renderSheet('FREE', { cap: 5, used: 5 });
    pick(photos(1));
    await waitFor(() => expect(screen.getByDisplayValue('Шпаклівка')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Додати 1/i }));
    await waitFor(() => expect(screen.getByText(/Записати у витрати/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Записати$/ }));

    // A «Зберегти» that would save nothing is a lie — the sheet closes and says why instead.
    await waitFor(() => expect(economyApi.addExpense).toHaveBeenCalled());
    expect(screen.queryByText(/Зберегти фото чеків/i)).toBeNull();
    expect(photosApi.upload).not.toHaveBeenCalled();
  });

  it('reads the fiscal QR on FREE too — no model runs, so there is nothing to sell', async () => {
    // «Безкоштовно все, що дав QR» (master decision, 2026-08-23).
    vi.mocked(decodeQrFromFile).mockResolvedValue(FISCAL);
    vi.mocked(receiptImportApi.parseQr).mockResolvedValue({
      items: [item('Шпаклівка', 345, 2)], depositAmount: null,
    });

    renderSheet('FREE');
    pick(photos(1));

    await waitFor(() => expect(screen.getByDisplayValue('Шпаклівка')).toBeTruthy());
    expect(receiptImportApi.parse).not.toHaveBeenCalled();
    expect(upgradeApi.click).not.toHaveBeenCalled();
  });

  it('on FREE a slip with no code never reaches the model, and says why', async () => {
    renderSheet('FREE');
    pick(photos(1));

    await waitFor(() => expect(upgradeApi.click).toHaveBeenCalledWith('RECEIPT_IMPORT'));
    expect(receiptImportApi.parse).not.toHaveBeenCalled();
  });

  it('skips files that are not photos and reads the rest', async () => {
    vi.mocked(receiptImportApi.parse).mockResolvedValue({
      items: [item('Цемент М500', 180, 1)], depositAmount: null,
    });
    renderSheet();
    pick([new File(['x'], 'notes.pdf', { type: 'application/pdf' }), photos(1)[0]]);

    await waitFor(() => expect(screen.getByDisplayValue('Цемент М500')).toBeTruthy());
    expect(receiptImportApi.parse).toHaveBeenCalledTimes(1);
  });

  it('one failing read never costs the batch its other receipts', async () => {
    const files = photos(2);
    vi.mocked(receiptImportApi.parse)
      .mockRejectedValueOnce(new Error('AI_UNAVAILABLE'))
      .mockResolvedValue({ items: [item('Цемент М500', 180, 1)], depositAmount: null });

    renderSheet();
    pick(files);

    await waitFor(() => expect(screen.getByDisplayValue('Цемент М500')).toBeTruthy());
    // The surviving slip is still receipt 2 — the numbering follows the pick, not the outcome.
    expect(screen.getByText(/Чек 2 · з фото/)).toBeTruthy();
  });
});
