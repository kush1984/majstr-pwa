import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { SketchReviewSheet } from './SketchReviewSheet.tsx';
import { sketchImportApi } from '@/api/sketchImport.ts';
import { toast } from '@/hooks/useToast.ts';
import type { SketchParseResponse } from '@/api/types.ts';
import { asButton } from '@/test/dom.ts';

vi.mock('@/api/sketchImport.ts', () => ({
  sketchImportApi: { parse: vi.fn(), commit: vi.fn() },
}));
vi.mock('@/api/photos.ts', () => ({ photosApi: { upload: vi.fn() } }));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// jsdom has no createObjectURL.
beforeEach(() => {
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  vi.clearAllMocks();
});

const parsed: SketchParseResponse = {
  sheetKind: 'HAND_DRAWN',
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

const onPrintedPlan = vi.fn();

function renderSheet() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  render(<SketchReviewSheet open onClose={() => {}} objectId="p1" onPrintedPlan={onPrintedPlan} />, { wrapper });
}

function sheet(name: string) {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' });
}

/** Drops files on the upload <input> (accept without capture — the second file input). */
function dropOnUpload(files: File[]) {
  fireEvent.change(document.querySelectorAll('input[type="file"]')[1], { target: { files } });
}

async function pickPhoto() {
  vi.mocked(sketchImportApi.parse).mockResolvedValue(parsed);
  dropOnUpload([sheet('sketch.jpg')]);
  await waitFor(() => expect(screen.getByDisplayValue('Спальня')).toBeTruthy());
}

describe('SketchReviewSheet', () => {
  it('sends every picked sheet in ONE parse call — a flat is a page per floor, read together', async () => {
    vi.mocked(sketchImportApi.parse).mockResolvedValue(parsed);
    renderSheet();

    dropOnUpload([sheet('floor-1.jpg'), sheet('floor-2.jpg'), sheet('schedule.jpg')]);

    await waitFor(() => expect(sketchImportApi.parse).toHaveBeenCalledTimes(1));
    const [, files] = vi.mocked(sketchImportApi.parse).mock.calls[0];
    expect(files.map((f) => f.name)).toEqual(['floor-1.jpg', 'floor-2.jpg', 'schedule.jpg']);
  });

  it('refuses a batch over the sheet cap instead of letting the server reject it', async () => {
    renderSheet();

    dropOnUpload(Array.from({ length: 11 }, (_, i) => sheet(`p${i}.jpg`)));

    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(expect.stringMatching(/Забагато аркушів/)),
    );
    expect(sketchImportApi.parse).not.toHaveBeenCalled();
  });

  it('hands a PRINTED PLAN to the import conveyor instead of reviewing it here', async () => {
    // The recogniser names the sheet and stops, so `rooms` is empty BY DESIGN. Reviewing that would
    // show «не вдалося нічого прочитати» over a plan that reads perfectly well on the other path —
    // which is exactly what a photographed БТІ sheet used to produce: chain products for areas, and
    // rooms with no walls at all.
    vi.mocked(sketchImportApi.parse).mockResolvedValue({
      sheetKind: 'PRINTED_PLAN', rooms: [], unitGuess: 'M', warnings: ['друкований план'],
    });
    renderSheet();

    dropOnUpload([sheet('IMG20260510130144.jpg'), sheet('IMG20260510130201.jpg')]);

    await waitFor(() => expect(onPrintedPlan).toHaveBeenCalledTimes(1));
    expect(onPrintedPlan.mock.calls[0][0].map((f: File) => f.name))
      .toEqual(['IMG20260510130144.jpg', 'IMG20260510130201.jpg']);
    expect(screen.queryByText(/Не вдалося нічого прочитати/)).toBeNull();
  });

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
    const commitBtn = screen.getByRole('button', { name: /Додати до замірів/ });
    expect(asButton(commitBtn).disabled).toBe(true);

    // Remove the flagged element (2nd delete-item button) → only the valid ceiling remains.
    const dels = screen.getAllByLabelText('Видалити елемент');
    fireEvent.click(dels[1]);

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Додати до замірів/ });
      expect(asButton(btn).disabled).toBe(false);
    });
  });

  it('commits the confirmed rooms and seeds the measurement cache', async () => {
    vi.mocked(sketchImportApi.commit).mockResolvedValue({ rooms: [], areaTotal: 7.5, linearTotal: 0, pieceTotal: 0 });
    renderSheet();
    await pickPhoto();

    fireEvent.click(screen.getAllByLabelText('Видалити елемент')[1]); // drop the invalid one
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Додати до замірів/ });
      expect(asButton(btn).disabled).toBe(false);
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
