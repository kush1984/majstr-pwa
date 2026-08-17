import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ActEditorPage } from './ActEditorPage.tsx';
import { actsApi } from '@/api/acts.ts';
import { formatMoney } from '@/lib/format.ts';
import type { ActProgressResponse, WorkActResponse } from '@/api/types.ts';

vi.mock('@/api/acts.ts', () => ({
  actsApi: {
    get: vi.fn(),
    progress: vi.fn(),
    updateHeader: vi.fn(() => Promise.resolve({} as WorkActResponse)),
    replaceItems: vi.fn(() => Promise.resolve({} as WorkActResponse)),
    signOffline: vi.fn(() => Promise.resolve({} as WorkActResponse)),
    remove: vi.fn(() => Promise.resolve()),
    fetchPdf: vi.fn(),
  },
}));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

function money(n: number): string {
  return formatMoney(n).replace(/\s+/g, ' ');
}

function draftAct(): WorkActResponse {
  return {
    id: 'a1', projectId: 'p1', number: '7', kind: 'INTERIM', status: 'DRAFT',
    issuedAt: '2026-08-14', periodFrom: '2026-08-01', periodTo: '2026-08-14',
    place: null, contractRef: null, note: null, showMaterials: true, showCumulative: true,
    advanceOffset: null, retentionPercent: null, sentAt: null, signedAt: null,
    signerName: null, signedOffline: false, addendumEstimateId: null, items: [],
    total: 0, payable: 0, createdAt: '2026-08-14', updatedAt: '2026-08-14',
  };
}

function progress(): ActProgressResponse {
  return {
    lines: [
      {
        estimateId: 'e1', estimateName: 'Чорнові', estimateCreatedAt: '2026-08-01', estimateItemId: 'i1', type: 'WORK',
        name: 'Шпаклювання стін', category: 'Стіни', unit: 'M2', unitPrice: 145,
        estimateQuantity: 136.5, done: 70, remaining: 66.5,
      },
      {
        estimateId: 'e1', estimateName: 'Чорнові', estimateCreatedAt: '2026-08-01', estimateItemId: 'i2', type: 'MATERIAL',
        name: 'Шпаклівка', category: 'Матеріали', unit: 'KG', unitPrice: 20,
        estimateQuantity: 100, done: 0, remaining: 100,
      },
      {
        estimateId: 'e2', estimateName: 'Чистові', estimateCreatedAt: '2026-08-05', estimateItemId: 'i3', type: 'WORK',
        name: 'Фарбування стель', category: 'Стеля', unit: 'M2', unitPrice: 90,
        estimateQuantity: 40, done: 0, remaining: 40,
      },
    ],
  };
}

function renderEditor(search = '') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/acts/a1${search}`]}>
        <Routes>
          <Route path="/acts/:id" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<ActEditorPage />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(actsApi.get).mockResolvedValue(draftAct());
  vi.mocked(actsApi.progress).mockResolvedValue(progress());
});

describe('ActEditorPage', () => {
  it('ticking a line fills the whole remainder into the total', async () => {
    renderEditor();

    const row = (await screen.findByText('Шпаклювання стін')).closest('.rounded-card') as HTMLElement;
    fireEvent.click(within(row).getByRole('checkbox')); // the line's own tick, not «show materials»

    // 66.5 × 145 = 9642.50 — a full-remainder tick, no typing.
    expect(await within(row).findByText(money(9642.5))).toBeTruthy();
  });

  it('entering more than the remainder warns and offers to convert the excess', async () => {
    renderEditor();

    await screen.findByText('Шпаклювання стін');
    const qtyInput = screen.getAllByRole('textbox').find((el) => (el as HTMLInputElement).className.includes('w-28'))!;
    fireEvent.change(qtyInput, { target: { value: '80' } }); // remainder is 66.5

    expect(await screen.findByText('Перевищує залишок за кошторисом')).toBeTruthy();
    fireEvent.click(screen.getByText('Оформити перевищення як додаткові роботи'));

    // The overflow (80 − 66.5 = 13.5) becomes an additional-works row.
    expect(await screen.findByDisplayValue(/понад кошторис/)).toBeTruthy();
  });

  it('turning off «Показувати матеріали» hides MATERIAL lines', async () => {
    renderEditor();

    await screen.findByText('Шпаклювання стін');
    expect(screen.getByText('Шпаклівка')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Показувати матеріали'));
    expect(screen.queryByText('Шпаклівка')).toBeNull();
    expect(screen.getByText('Шпаклювання стін')).toBeTruthy(); // works line stays
  });

  it('unscoped (Acts-tab entry) shows every signed estimate', async () => {
    renderEditor();

    expect(await screen.findByText('Шпаклювання стін')).toBeTruthy(); // e1
    expect(screen.getByText('Фарбування стель')).toBeTruthy(); // e2
    expect(screen.getByText('Чорнові')).toBeTruthy();
    expect(screen.getByText('Чистові')).toBeTruthy();
  });

  it('?scope= restricts the editor to that one estimate', async () => {
    renderEditor('?scope=e1');

    expect(await screen.findByText('Шпаклювання стін')).toBeTruthy(); // e1 shown
    expect(screen.getByText('Чорнові')).toBeTruthy();
    expect(screen.queryByText('Фарбування стель')).toBeNull(); // e2 hidden
    expect(screen.queryByText('Чистові')).toBeNull();
  });

  it('warns when an additional line duplicates a position from another signed estimate', async () => {
    renderEditor('?scope=e1'); // e2 hidden, but its «Фарбування стель» still triggers the warning
    await screen.findByText('Шпаклювання стін');

    fireEvent.click(screen.getByText('+ Додати роботу'));
    const nameField = screen.getByPlaceholderText('Почни вводити — підкажемо з каталогу');
    fireEvent.change(nameField, { target: { value: 'Фарбування стель' } });

    expect(await screen.findByText(/вже є в кошторисі «Чистові»/)).toBeTruthy();
  });
});
