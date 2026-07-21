import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { SketchReviewSheet } from './SketchReviewSheet.tsx';
import { sketchImportApi } from '@/api/sketchImport.ts';
import type { SketchParseResponse } from '@/api/types.ts';

vi.mock('@/api/sketchImport.ts', () => ({
  sketchImportApi: { parse: vi.fn(), commit: vi.fn() },
}));
vi.mock('@/api/photos.ts', () => ({ photosApi: { upload: vi.fn() } }));

// jsdom has no createObjectURL.
beforeEach(() => {
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  vi.clearAllMocks();
});

const parsed: SketchParseResponse = {
  unitGuess: 'CM',
  warnings: ['масштаб не вказано'],
  rooms: [
    {
      name: 'Спальня',
      confidence: 'high',
      items: [
        {
          type: 'SURFACE',
          name: 'Стеля',
          unit: 'M2',
          confidence: 'high',
          note: null,
          result: 7.5,
          payload: { unit: 'CM', segments: [{ shape: 'rect', mode: 'd', values: { a: 300, b: 250 } }], openings: [] },
        },
        {
          type: 'SURFACE',
          name: 'Фронтон',
          unit: 'M2',
          confidence: 'low',
          note: 'розмір нерозбірливий',
          result: null,
          payload: { unit: 'CM', segments: [{ shape: 'tri', mode: 'bh', values: { b: 400 } }], openings: [] },
        },
      ],
    },
  ],
};

function renderSheet() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  render(<SketchReviewSheet open onClose={() => {}} objectId="p1" />, { wrapper });
}

async function pickPhoto() {
  vi.mocked(sketchImportApi.parse).mockResolvedValue(parsed);
  const file = new File([new Uint8Array([1, 2, 3])], 'sketch.jpg', { type: 'image/jpeg' });
  // The upload <input> (accept without capture) is the second file input.
  const inputs = document.querySelectorAll('input[type="file"]');
  fireEvent.change(inputs[1], { target: { files: [file] } });
  await waitFor(() => expect(screen.getByDisplayValue('Спальня')).toBeTruthy());
}

describe('SketchReviewSheet', () => {
  it('shows the recognised rooms, warnings, and flags low-confidence items', async () => {
    renderSheet();
    await pickPhoto();

    expect(screen.getByText('масштаб не вказано')).toBeTruthy();
    // The low-confidence element is flagged with its note.
    expect(screen.getByText('розмір нерозбірливий')).toBeTruthy();
    expect(screen.getByText('перевірте')).toBeTruthy();
  });

  it('blocks commit until the flagged (invalid) element is fixed or removed', async () => {
    renderSheet();
    await pickPhoto();

    // "Фронтон" has an incomplete triangle (only b) → its result is invalid → commit disabled.
    const commitBtn = screen.getByRole('button', { name: /Додати до замірів/ }) as HTMLButtonElement;
    expect(commitBtn.disabled).toBe(true);

    // Remove the flagged element (2nd delete-item button) → only the valid ceiling remains.
    const dels = screen.getAllByLabelText('Видалити елемент');
    fireEvent.click(dels[1]);

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Додати до замірів/ }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
  });

  it('commits the confirmed rooms and seeds the measurement cache', async () => {
    vi.mocked(sketchImportApi.commit).mockResolvedValue({ rooms: [], areaTotal: 7.5, linearTotal: 0, pieceTotal: 0 });
    renderSheet();
    await pickPhoto();

    fireEvent.click(screen.getAllByLabelText('Видалити елемент')[1]); // drop the invalid one
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Додати до замірів/ }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: /Додати до замірів/ }));

    await waitFor(() => expect(sketchImportApi.commit).toHaveBeenCalledTimes(1));
    const [, req] = vi.mocked(sketchImportApi.commit).mock.calls[0];
    expect(req.rooms).toHaveLength(1);
    expect(req.rooms[0].name).toBe('Спальня');
    expect(req.rooms[0].items).toHaveLength(1);
    expect(req.rooms[0].items[0].name).toBe('Стеля');
  });
});
