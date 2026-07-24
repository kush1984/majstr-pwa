import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ProjectImportSheet } from './ProjectImportSheet.tsx';
import { projectImportApi } from '@/api/projectImport.ts';
import type { ProjectImportParseResponse } from '@/api/types.ts';

vi.mock('@/api/projectImport.ts', () => ({
  projectImportApi: { parse: vi.fn(), commit: vi.fn() },
}));

beforeEach(() => vi.clearAllMocks());

const empty: ProjectImportParseResponse = {
  floors: [], coverings: [], totalAreaM2: null, ceilingHeightsMm: {}, warnings: [],
};

const schedule: ProjectImportParseResponse = {
  ...empty,
  totalAreaM2: 30,
  floors: [{
    floor: null,
    rooms: [{ number: '4', name: 'Спальня', areaM2: 30, perimeterMm: null, wallSegmentsMm: null, openings: [], confidence: 'high', note: null }],
  }],
};

const plan: ProjectImportParseResponse = {
  ...empty,
  floors: [{
    floor: null,
    rooms: [{
      number: '4', name: null, areaM2: null, perimeterMm: 22000, wallSegmentsMm: null,
      openings: [
        { kind: 'вікно', wMm: 1400, hMm: 1500, sillMm: 900, note: null },
        { kind: 'двері', wMm: 900, hMm: 2100, sillMm: null, note: null },
      ],
      confidence: 'medium', note: null,
    }],
  }],
};

function renderSheet() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  render(<ProjectImportSheet open onClose={() => {}} objectId="p1" />, { wrapper });
}

const pdf = (name: string) => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' });

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
    await waitFor(() => expect(projectImportApi.parse).toHaveBeenCalledTimes(2)); // noise skipped

    // No «H=» anywhere in this fixture → the height is asked once for the floor.
    const heightInput = await screen.findByPlaceholderText('2,7');
    fireEvent.change(heightInput, { target: { value: '2,7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далі' }));

    // Review: the merged room with the full package + a way back to other pages.
    await waitFor(() => expect(screen.getByDisplayValue('Спальня')).toBeTruthy());
    expect(screen.getByText(/Розпізнано з/)).toBeTruthy();
    expect(screen.getByDisplayValue('55.41')).toBeTruthy(); // 22×2.7 − прорізи
    expect(screen.getByDisplayValue('21.1')).toBeTruthy();  // плінтус без дверей
    expect(screen.getByText(/Стіни: 59.4 брутто − 3.99 прорізи = 55.41/)).toBeTruthy();

    // Commit → payloads the server recomputes. NO auto-ceiling (a floor duplicate
    // that used to double every total) — the checkbox adds it when wanted.
    fireEvent.click(screen.getByRole('button', { name: /Додати 1 кімнат/ }));
    await waitFor(() => expect(projectImportApi.commit).toHaveBeenCalled());
    const req = vi.mocked(projectImportApi.commit).mock.calls[0][1];
    expect(req.rooms).toHaveLength(1);
    expect(req.rooms[0].name).toBe('Спальня');
    expect(req.rooms[0].floor).toBe('1'); // from the FILENAME («1п»)
    const names = req.rooms[0].items.map((i) => i.name);
    expect(names).toEqual(['Підлога', 'Стіни', 'Плінтус', 'Відкоси']);
    // The whole flow in one test (2 parses → heights → review → commit) needs more than
    // the 5 s default when the full suite runs in parallel.
  }, 20_000);

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

  it('a coverings-only pick parses NOTHING and explains why (the file list is the fallback)', async () => {
    renderSheet();
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [pdf('специфікація покриттів.pdf')] },
    });
    // Not useful → no auto-parse; the master lands on the list with the honest note.
    await waitFor(() => expect(screen.getByText(/дає ЛИШЕ площі|Розпізнаю 0 із 1/)).toBeTruthy());
    expect(projectImportApi.parse).not.toHaveBeenCalled();
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
    // No perimeter anywhere → the review says EXPLICITLY that walls were not computed.
    expect(screen.getByText(/Стіни й плінтус не пораховані/)).toBeTruthy();
  });
});
