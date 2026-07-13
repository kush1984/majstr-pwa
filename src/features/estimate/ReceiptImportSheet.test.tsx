import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ReceiptImportSheet } from './ReceiptImportSheet.tsx';
import { receiptImportApi } from '@/api/receiptImport.ts';
import { photosApi } from '@/api/photos.ts';

vi.mock('@/api/receiptImport.ts', () => ({
  receiptImportApi: { parse: vi.fn(), commit: vi.fn() },
}));
vi.mock('@/api/photos.ts', () => ({
  photosApi: { upload: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

function renderSheet() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

    const { container } = renderSheet();

    // Fire the hidden upload input (second file input) with a JPEG file.
    const inputs = container.querySelectorAll('input[type="file"]');
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
    // After commit the "save receipt photo?" prompt appears.
    await waitFor(() => expect(screen.getByText(/Зберегти фото чека/i)).toBeTruthy());
  });
});
