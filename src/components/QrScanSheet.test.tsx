import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/lib/i18n.ts';
import { QrScanSheet } from './QrScanSheet.tsx';
import { decodeQrFromFile } from '@/lib/qr.ts';

// `looksFiscal` stays real — it is half of what this sheet decides.
vi.mock('@/lib/qr.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/qr.ts')>()),
  decodeQr: vi.fn(() => Promise.resolve(null)),
  decodeQrFromFile: vi.fn(() => Promise.resolve(null)),
}));

const FISCAL = 'https://cabinet.tax.gov.ua/cashregs/check?fn=4000123456&id=17&date=20260815&time=143005&sm=690.00';

function pickPhoto() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], 'receipt.jpg', { type: 'image/jpeg' })] } });
}

beforeEach(() => vi.clearAllMocks());

describe('QrScanSheet', () => {
  // jsdom has no mediaDevices, which is exactly the case that matters: a phone that denied the
  // camera, or iOS Safari on plain http, must still be able to read a receipt.
  it('says the camera is unavailable and still offers the photo route', () => {
    render(<QrScanSheet open onClose={() => {}} onScanned={() => {}} />);

    expect(screen.getByText(/Камера недоступна/)).toBeTruthy();
    expect(screen.getByText(/Вибрати фото чека/)).toBeTruthy();
  });

  it('hands a fiscal payload from a picked photo straight up to the caller', async () => {
    vi.mocked(decodeQrFromFile).mockResolvedValue(FISCAL);
    const onScanned = vi.fn();
    render(<QrScanSheet open onClose={() => {}} onScanned={onScanned} />);

    pickPhoto();

    await waitFor(() => expect(onScanned).toHaveBeenCalledWith(FISCAL));
  });

  it('names a code that is not a receipt instead of spending a round trip on it', async () => {
    vi.mocked(decodeQrFromFile).mockResolvedValue('WIFI:S:MyNet;T:WPA;P:secret;;');
    const onScanned = vi.fn();
    render(<QrScanSheet open onClose={() => {}} onScanned={onScanned} />);

    pickPhoto();

    await screen.findByText(/Це не QR фіскального чека/);
    expect(onScanned).not.toHaveBeenCalled();
  });

  // A receipt prints several codes. «Це не чек» about the shop's marketing link reads as the
  // feature being broken; showing the payload tells the master he aimed at the wrong one.
  it('shows WHICH code it read, not just that it was the wrong one', async () => {
    vi.mocked(decodeQrFromFile).mockResolvedValue('https://shorturl.at/Qosce');
    render(<QrScanSheet open onClose={() => {}} onScanned={() => {}} />);

    pickPhoto();

    await screen.findByText(/shorturl\.at\/Qosce/);
  });

  it('tells the master when the photo simply holds no code', async () => {
    vi.mocked(decodeQrFromFile).mockResolvedValue(null);
    const onScanned = vi.fn();
    render(<QrScanSheet open onClose={() => {}} onScanned={onScanned} />);

    pickPhoto();

    await screen.findByText(/не видно QR-коду/);
    expect(onScanned).not.toHaveBeenCalled();
  });
});
