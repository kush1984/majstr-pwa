import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ProjectImportSheet } from './ProjectImportSheet.tsx';
import { projectImportApi } from '@/api/projectImport.ts';
import type { ProjectImportParseResponse } from '@/api/types.ts';
import { anImportFloor, anImportRoom } from '@/test/factories.ts';

vi.mock('@/api/projectImport.ts', () => ({
  projectImportApi: { triage: vi.fn(), parse: vi.fn(), commit: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  // These tests use PDFs with no text layer, so there is nothing to triage and the keyword
  // classification decides — the fallback path, exercised on purpose. The model-led path lives in
  // ProjectImportSheet.triage.test.tsx, which mocks text extraction to have something to classify.
  vi.mocked(projectImportApi.triage).mockRejectedValue(new Error('no text to triage'));
});

const empty: ProjectImportParseResponse = {
  floors: [], coverings: [], totalAreaM2: null, ceilingHeightsMm: {}, warnings: [],
};

const schedule: ProjectImportParseResponse = {
  ...empty,
  totalAreaM2: 30,
  // The schedule table alone: an area, but no gabarits to check it against.
  floors: [anImportFloor({
    rooms: [anImportRoom({ number: '4', name: 'Спальня', areaM2: 30 })],
  })],
};

const plan: ProjectImportParseResponse = {
  ...empty,
  // Confirmed gabarits (5×6 = 30 m² matches the schedule) → real per-wall geometry.
  floors: [anImportFloor({
    rooms: [anImportRoom({
      number: '4', name: null, areaM2: 30,
      widthMm: 5000, lengthMm: 6000,
      openings: [
        { kind: 'вікно', wMm: 1400, hMm: 1500, sillMm: 900, note: null },
        { kind: 'двері', wMm: 900, hMm: 2100, sillMm: null, note: null },
      ],
      confidence: 'medium',
    })],
  })],
};

function renderSheet() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  render(<ProjectImportSheet open onClose={() => {}} objectId="p1" />, { wrapper });
}

const pdf = (name: string) => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' });
const photo = (name: string) => new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type: 'image/jpeg' });


describe('ProjectImportSheet', () => {
  it('AUTO-parses the useful sheets (no file screen), asks only the missing height, commits the package', async () => {
    vi.mocked(projectImportApi.parse).mockImplementation((_id, _blob, _name, kind) =>
      Promise.resolve(kind === 'ROOM_SCHEDULE' ? schedule : plan));
    vi.mocked(projectImportApi.commit).mockResolvedValue({ rooms: [], areaTotal: 0, linearTotal: 0, pieceTotal: 0 });
    renderSheet();

    // Pick two useful PDFs + a noise sheet: the master isn't asked anything — the
    // classifier picked the useful ones and parsing starts immediately.
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [pdf('експлікація 1п.pdf'), pdf('обмірний план 1п.pdf'), pdf('план меблів.pdf')] },
    });
    // Explicit timeouts, not the 1 s default: picking these files runs the real
    // pdfjs page-text pass, which on a loaded CI box takes several seconds. With the
    // default this test is FLAKY — it passed in 0.8 s and failed on the same commit
    // minutes later. The test budget below is what actually bounds it.
    //
    // 2026-07-31, SOLVED: this was the long-hunted flake. Not slowness at all — pdfjs can HANG
    // outright on the deliberately-corrupt 4-byte «%PDF» these fixtures use, and `onPick` awaited
    // it with no bound, so the sheet never left its first screen and `parse` was never called.
    // `pdfPageTexts` is bounded now (projectDocs.ts), which is a product fix as much as a test one:
    // a master with a corrupt PDF used to get an import sheet frozen on «Обрати файли».
    // These waits are 20 s so they OUTLAST that 10 s bound — the point is to prove the flow
    // RECOVERS from a hang, and a wait shorter than the guard could never see it happen.
    await waitFor(() => expect(projectImportApi.parse).toHaveBeenCalledTimes(2), // noise skipped
      { timeout: 20_000 });

    // No «H=» anywhere in this fixture → the height is asked once for the floor.
    const heightInput = await screen.findByPlaceholderText('2,7', {}, { timeout: 20_000 });
    fireEvent.change(heightInput, { target: { value: '2,7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далі' }));

    // Review: the merged room with the v2 package + a way back to other pages.
    await waitFor(() => expect(screen.getByDisplayValue('Спальня')).toBeTruthy(), { timeout: 20_000 });
    expect(screen.getByText(/Розпізнано з/)).toBeTruthy();
    // Honesty coverage summary is shown (recognised N rooms).
    expect(screen.getByText(/Розпізнано 1 кімнат/)).toBeTruthy();
    // The plinth's running length is a plain, editable number (no reveal-sides hack).
    expect(screen.getByDisplayValue('21.1')).toBeTruthy(); // перимeтр − двері

    // Commit → payloads the server recomputes. Walls are FOUR separate elements now, each a
    // real width×height rect; NO auto-ceiling (the checkbox adds it when wanted).
    fireEvent.click(screen.getByRole('button', { name: /Додати 1 кімнат/ }));
    await waitFor(() => expect(projectImportApi.commit).toHaveBeenCalled());
    const req = vi.mocked(projectImportApi.commit).mock.calls[0][1];
    expect(req.rooms).toHaveLength(1);
    expect(req.rooms[0].name).toBe('Спальня');
    expect(req.rooms[0].floor).toBe('1'); // from the FILENAME («1п»)
    const items = req.rooms[0].items;
    expect(items.map((i) => i.name)).toEqual([
      'Підлога', 'Стіна 1', 'Стіна 2', 'Стіна 3', 'Стіна 4', 'Плінтус', 'Відкоси',
    ]);
    // Floor is a real 5×6 rect (not a "direct area"); the plinth is a length-mode LINEAR.
    expect(items[0]).toMatchObject({
      type: 'SURFACE', payload: { segments: [{ shape: 'rect', values: { a: 5, b: 6 } }] },
    });
    expect(items.find((i) => i.name === 'Плінтус')).toMatchObject({
      type: 'LINEAR', payload: { mode: 'length', width: 21.1 },
    });
    // The whole flow in one test (2 parses → heights → review → commit) needs more than
    // the 5 s default when the full suite runs in parallel.
  }, 60_000);

  it('the ceilings checkbox opts every room back into a ceiling element', async () => {
    vi.mocked(projectImportApi.parse).mockResolvedValue(schedule);
    vi.mocked(projectImportApi.commit).mockResolvedValue({ rooms: [], areaTotal: 0, linearTotal: 0, pieceTotal: 0 });
    renderSheet();

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [pdf('експлікація 1п.pdf')] },
    });
    const heightInput = await screen.findByPlaceholderText('2,7');
    fireEvent.change(heightInput, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далі' }));

    const ceilBox = await screen.findByRole('checkbox', { name: /Створювати стелю/ });
    fireEvent.click(ceilBox);
    fireEvent.click(screen.getByRole('button', { name: /Додати 1 кімнат/ }));

    await waitFor(() => expect(projectImportApi.commit).toHaveBeenCalled());
    const names = vi.mocked(projectImportApi.commit).mock.calls[0][1].rooms[0].items.map((i) => i.name);
    expect(names).toContain('Стеля');
  });

  it('gabarits the checksum refuses are SHOWN with «все одно взяти», never silently dropped', async () => {
    // 5,0 × 4,0 = 20 m² but the table says 30 → the checksum rejects. Before this was dropped
    // in silence and the master saw a room of zeros with no explanation.
    const mismatched: ProjectImportParseResponse = {
      ...empty,
      floors: [anImportFloor({
        rooms: [anImportRoom({
          number: '4', name: 'Спальня', areaM2: 30,
          widthMm: 5000, lengthMm: 4000, ceilingHmm: 2700,
        })],
      })],
    };
    vi.mocked(projectImportApi.parse).mockResolvedValue(mismatched);
    vi.mocked(projectImportApi.commit).mockResolvedValue({ rooms: [], areaTotal: 0, linearTotal: 0, pieceTotal: 0 });
    renderSheet();

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [pdf('обмірний план 1п.pdf')] },
    });

    // The plan printed «H=2700», so the heights step is skipped — straight to the review.
    // The read-but-refused sizes are visible there, with the reason and the escape hatch.
    await waitFor(() => expect(screen.getByText(/не сходиться з площею/)).toBeTruthy(), { timeout: 20_000 });
    expect(screen.getByText(/розміри прочитані, але не збіглися/)).toBeTruthy();

    // Taking them anyway re-seeds the package: the walls get real runs (5 and 4 m × 2.7).
    fireEvent.click(screen.getByRole('button', { name: 'все одно взяти' }));
    fireEvent.click(screen.getByRole('button', { name: /Додати 1 кімнат/ }));
    await waitFor(() => expect(projectImportApi.commit).toHaveBeenCalled());
    const items = vi.mocked(projectImportApi.commit).mock.calls[0][1].rooms[0].items;
    expect(items.find((i) => i.name === 'Стіна 1')).toMatchObject({
      payload: { segments: [{ shape: 'rect', values: { a: 5, b: 2.7 } }] },
    });
    expect(items.find((i) => i.name === 'Підлога')).toMatchObject({
      payload: { segments: [{ shape: 'rect', values: { a: 5, b: 4 } }] },
    });
  }, 60_000);

  it('a coverings-only pick parses NOTHING and explains why (the file list is the fallback)', async () => {
    renderSheet();
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [pdf('специфікація покриттів.pdf')] },
    });
    // Not useful → no auto-parse; the master lands on the list with the honest note.
    await waitFor(() => expect(screen.getByText(/дає ЛИШЕ площі|Розпізнаю 0 із 1/)).toBeTruthy());
    expect(projectImportApi.parse).not.toHaveBeenCalled();
  });

  it('a PHOTOGRAPHED plan is ticked, not dropped — every signal the picker reads is absent from it', async () => {
    renderSheet();

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [photo('IMG20260510130144.jpg'), photo('IMG20260510130201.jpg')] },
    });

    // Camera names classify as nothing and a photo has no text layer, so the sheet used to land on
    // «Розпізнаю 0 із 2» with the button dead over the plan he had just photographed.
    await waitFor(() => expect(screen.getByText(/Розпізнаю 2 із 2/)).toBeTruthy());
  });

  it('cross-check: a lost room makes the schedule total mismatch loudly', async () => {
    vi.mocked(projectImportApi.parse).mockResolvedValue({ ...schedule, totalAreaM2: 204 });
    renderSheet();

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [pdf('експлікація 1п.pdf')] },
    });

    const heightInput = await screen.findByPlaceholderText('2,7');
    fireEvent.change(heightInput, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далі' }));

    await waitFor(() => expect(screen.getByText(/не сходиться/)).toBeTruthy());
  });
});

