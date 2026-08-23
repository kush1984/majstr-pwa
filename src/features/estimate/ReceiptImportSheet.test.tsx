import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ReceiptImportSheet } from './ReceiptImportSheet.tsx';
import { receiptImportApi } from '@/api/receiptImport.ts';
import { economyApi } from '@/api/economy.ts';
import { upgradeApi } from '@/api/upgrade.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import type { UserResponse } from '@/api/types.ts';

vi.mock('@/api/receiptImport.ts', () => ({
  receiptImportApi: { parse: vi.fn(), parseQr: vi.fn(), commit: vi.fn() },
}));
vi.mock('@/api/upgrade.ts', () => ({
  upgradeApi: { click: vi.fn(() => Promise.resolve()), interest: vi.fn(() => Promise.resolve()) },
}));
// The camera and the decoders belong to QrScanSheet's own test; here only the payload matters.
vi.mock('@/components/QrScanSheet.tsx', () => ({
  QrScanSheet: ({ open, onScanned }: { open: boolean; onScanned: (p: string) => void }) =>
    open ? (
      <button type="button" onClick={() => onScanned('fn=4000123456&id=17&date=20260815&sm=690.00')}>
        scan-qr
      </button>
    ) : null,
}));
vi.mock('@/api/photos.ts', () => ({
  photosApi: { upload: vi.fn() },
}));
vi.mock('@/api/economy.ts', () => ({
  economyApi: { addExpense: vi.fn(() => Promise.resolve()) },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const baseMe: UserResponse = {
  id: 'u1', email: 'm@e.com', fullName: 'M', trades: [], customTrades: [], phone: '1',
  companyName: 'C', logoUrl: null, plan: 'PRO', role: 'USER', emailVerified: true,
  createdAt: '2026-01-01', consentedToPrivacyAt: '2026-01-01', acknowledgedClientDataAt: '2026-01-01',
  planExpiresAt: null, autoRenew: false, cardMask: null, trialStartedAt: null, referralCode: 'r1',
  legalName: null, taxId: null, legalAddress: null, iban: null, bankName: null, vatPayer: false,
  vatId: null, taxGroup: null, taxRate: null, docCity: null, actNumberFormat: 'PLAIN',
};

function renderSheet(plan: UserResponse['plan'] = 'PRO') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, { ...baseMe, plan });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <ReceiptImportSheet open onClose={() => {}} estimateId="e1" projectId="p1" />,
    { wrapper },
  );
}

beforeEach(() => vi.clearAllMocks());

describe('ReceiptImportSheet', () => {
  it('parses a receipt photo, then appends the reviewed lines to the estimate', async () => {
    vi.mocked(receiptImportApi.parse).mockResolvedValue({
      items: [
        { name: 'Цемент М500', unit: 'PIECE', quantity: 2, unitPrice: 180, type: 'MATERIAL', category: null, issues: [] },
      ],
      depositAmount: null,
    });
    vi.mocked(receiptImportApi.commit).mockResolvedValue({
      id: 'e1', projectId: 'p1', name: null, status: 'DRAFT', validUntil: null, notes: null,
      createdAt: '', updatedAt: '', items: [], worksSubtotal: 0, materialsSubtotal: 360, total: 360,
      depositAmount: null, balance: 360,
    });

    renderSheet();

    // Fire the hidden upload input (second file input) with a JPEG file.
    const inputs = document.querySelectorAll('input[type="file"]');
    const upload = inputs[inputs.length - 1] as HTMLInputElement;
    const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });
    fireEvent.change(upload, { target: { files: [file] } });

    await waitFor(() => expect(receiptImportApi.parse).toHaveBeenCalledWith('e1', file));
    // Review renders the parsed line.
    await waitFor(() => expect(screen.getByDisplayValue('Цемент М500')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Додати 1/i }));

    await waitFor(() =>
      expect(receiptImportApi.commit).toHaveBeenCalledWith('e1', [
        { name: 'Цемент М500', unit: 'PIECE', quantity: 2, unitPrice: 180, type: 'MATERIAL', category: null },
      ]),
    );
    // After commit the "log as expense?" prompt appears first (receipt total 2×180 = 360).
    await waitFor(() => expect(screen.getByText(/Записати у витрати/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Записати$/ }));
    await waitFor(() =>
      expect(economyApi.addExpense).toHaveBeenCalledWith('p1', expect.objectContaining({ amount: 360, category: 'MATERIALS' })),
    );

    // Then the "save receipt photo?" prompt appears.
    await waitFor(() => expect(screen.getByText(/Зберегти фото чека/i)).toBeTruthy());
  });

  it('reads the fiscal QR into the same review — free, so FREE gets there too', async () => {
    // «Безкоштовно все, що дав QR» (master decision, 2026-08-23): no model runs on this path.
    vi.mocked(receiptImportApi.parseQr).mockResolvedValue({
      items: [
        { name: 'Шпаклівка', unit: 'PIECE', quantity: 2, unitPrice: 345, type: 'MATERIAL', category: null, issues: [] },
      ],
      depositAmount: null,
    });
    renderSheet('FREE');

    fireEvent.click(screen.getByRole('button', { name: /Зчитати QR/ }));
    fireEvent.click(screen.getByText('scan-qr'));

    await waitFor(() =>
      expect(receiptImportApi.parseQr).toHaveBeenCalledWith('e1', 'fn=4000123456&id=17&date=20260815&sm=690.00'));
    await waitFor(() => expect(screen.getByDisplayValue('Шпаклівка')).toBeTruthy());
    expect(upgradeApi.click).not.toHaveBeenCalled();
  });

  it('the QR route never offers to keep a photo — it never held one', async () => {
    vi.mocked(receiptImportApi.parseQr).mockResolvedValue({
      items: [
        { name: 'Шпаклівка', unit: 'PIECE', quantity: 1, unitPrice: 345, type: 'MATERIAL', category: null, issues: [] },
      ],
      depositAmount: null,
    });
    vi.mocked(receiptImportApi.commit).mockResolvedValue({
      id: 'e1', projectId: 'p1', name: null, status: 'DRAFT', validUntil: null, notes: null,
      createdAt: '', updatedAt: '', items: [], worksSubtotal: 0, materialsSubtotal: 345, total: 345,
      depositAmount: null, balance: 345,
    });
    renderSheet();

    fireEvent.click(screen.getByRole('button', { name: /Зчитати QR/ }));
    fireEvent.click(screen.getByText('scan-qr'));
    await waitFor(() => expect(screen.getByDisplayValue('Шпаклівка')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Додати 1/i }));

    // The expense offer still makes sense — the money was spent either way.
    await waitFor(() => expect(screen.getByText(/Записати у витрати/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Записати$/ }));
    await waitFor(() => expect(economyApi.addExpense).toHaveBeenCalled());

    // …but there is no file to keep, so that dialog must not appear at all.
    await waitFor(() => expect(screen.queryByText(/Записати у витрати/i)).toBeNull());
    expect(screen.queryByText(/Зберегти фото чека/i)).toBeNull();
  });

  it('on FREE the photo routes are the ones that open the upsell', async () => {
    renderSheet('FREE');

    fireEvent.click(screen.getByRole('button', { name: /Зробити фото/ }));

    await waitFor(() => expect(upgradeApi.click).toHaveBeenCalledWith('RECEIPT_IMPORT'));
    expect(receiptImportApi.parse).not.toHaveBeenCalled();
  });
});
