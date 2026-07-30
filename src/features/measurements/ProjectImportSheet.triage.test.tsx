import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ProjectImportSheet } from './ProjectImportSheet.tsx';
import { projectImportApi } from '@/api/projectImport.ts';
import { anImportFloor, anImportRoom } from '@/test/factories.ts';
import type { ProjectImportParseResponse } from '@/api/types.ts';

vi.mock('@/api/projectImport.ts', () => ({
  projectImportApi: { triage: vi.fn(), parse: vi.fn(), commit: vi.fn() },
}));

// pdfjs cannot run in jsdom (no DOMMatrix), so page text is stubbed — everything else in the
// classifier is the real thing. Without text there is nothing to triage, which is the one condition
// this file needs and the main test file deliberately lacks.
vi.mock('@/lib/projectDocs.ts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/projectDocs.ts')>('@/lib/projectDocs.ts');
  return { ...actual, pdfPageTexts: vi.fn().mockResolvedValue(['ОБМІРНИЙ ПЛАН А-03 1 поверх 3545 4990']) };
});

beforeEach(() => vi.clearAllMocks());

const pdf = (name: string) =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' });

const plan: ProjectImportParseResponse = {
  floors: [anImportFloor({ rooms: [anImportRoom({ number: '4', name: 'Спальня', areaM2: 30 })] })],
  coverings: [], totalAreaM2: null, ceilingHeightsMm: {}, warnings: [],
};

const renderSheet = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<ProjectImportSheet open objectId="obj-1" onClose={() => {}} />, { wrapper });
};

describe('the model sorts the sheets, the keyword list no longer decides', () => {
  it('a sheet no keyword recognises is read anyway, because triage said what it is', async () => {
    // «лист 7.pdf» matches none of our patterns, and its stamp is Latin-scripted here — under the
    // old rule it was never sent. The model reads the title and that answer is what counts.
    vi.mocked(projectImportApi.triage).mockImplementation(async (_id, sheets) =>
      sheets.map((s) => ({
        id: s.id, title: 'ОБМІРНИЙ ПЛАН', kind: 'PLAN_MEASURE' as const, floor: '1',
        version: 'AFTER' as const, hasRoomTable: true, hasDimensions: true,
        hasOpeningSizes: false, worthReading: true, note: null,
      })));
    vi.mocked(projectImportApi.parse).mockResolvedValue(plan);

    renderSheet();
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [pdf('лист 7.pdf')] },
    });

    await waitFor(() => expect(projectImportApi.triage).toHaveBeenCalled(), { timeout: 10_000 });
    // ONE call for the whole set, carrying the sheet's text — not one call per sheet, and nothing
    // expensive before it.
    const [, sheets] = vi.mocked(projectImportApi.triage).mock.calls[0];
    expect(sheets).toHaveLength(1);
    expect(sheets[0].text).toContain('ОБМІРНИЙ ПЛАН');
    // …and the sheet the keywords would have discarded is the one that gets read.
    await waitFor(() => expect(projectImportApi.parse).toHaveBeenCalled(), { timeout: 10_000 });
    expect(vi.mocked(projectImportApi.parse).mock.calls[0][3]).toBe('PLAN_MEASURE');
  }, 20_000);

  it('a sheet triage calls useless is not read', async () => {
    vi.mocked(projectImportApi.triage).mockImplementation(async (_id, sheets) =>
      sheets.map((s) => ({
        id: s.id, title: 'ТИТУЛЬНИЙ ЛИСТ', kind: 'OTHER' as const, floor: null,
        version: 'UNKNOWN' as const, hasRoomTable: false, hasDimensions: false,
        hasOpeningSizes: false, worthReading: false, note: null,
      })));

    renderSheet();
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [pdf('обмірний план.pdf')] },
    });

    // The FILE NAME says measure plan; the sheet itself says title page. The sheet wins, and the
    // master lands on the list to decide rather than paying for a cover page.
    await waitFor(() => expect(projectImportApi.triage).toHaveBeenCalled(), { timeout: 10_000 });
    await waitFor(() => expect(screen.getByText(/Розпізнаю/)).toBeTruthy(), { timeout: 10_000 });
    expect(projectImportApi.parse).not.toHaveBeenCalled();
  }, 20_000);

  it('when triage cannot run, the keyword classification still gets the sheet read', async () => {
    // Offline, unconfigured, refused — the import must not become unusable, only less sure.
    vi.mocked(projectImportApi.triage).mockRejectedValue(new Error('offline'));
    vi.mocked(projectImportApi.parse).mockResolvedValue(plan);

    renderSheet();
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [pdf('обмірний план 1п.pdf')] },
    });

    await waitFor(() => expect(projectImportApi.parse).toHaveBeenCalled(), { timeout: 10_000 });
  }, 20_000);
});
