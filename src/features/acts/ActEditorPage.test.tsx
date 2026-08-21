import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
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
    addReceipt: vi.fn(() => Promise.resolve({})),
    updateReceipt: vi.fn(() => Promise.resolve({})),
    removeReceipt: vi.fn(() => Promise.resolve()),
    receiptFileUrl: (actId: string, receiptId: string) => `/api/acts/${actId}/receipts/${receiptId}/file`,
  },
}));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/api/portal.ts', () => ({
  actPortalApi: { publish: vi.fn(() => Promise.resolve({ url: 'https://majstr.pro/portal/index.html?a=TOK', shared: true })), sendEmail: vi.fn(), state: vi.fn() },
}));
vi.mock('@/api/photos.ts', () => ({ photosApi: { fetchBlobUrl: vi.fn(() => Promise.resolve('blob:receipt')) } }));

function money(n: number): string {
  return formatMoney(n).replace(/\s+/g, ' ');
}

function draftAct(): WorkActResponse {
  return {
    id: 'a1', projectId: 'p1', number: '7', title: null, kind: 'INTERIM', status: 'DRAFT',
    issuedAt: '2026-08-14', periodFrom: '2026-08-01', periodTo: '2026-08-14',
    place: null, contractRef: null, note: null, showMaterials: true, showCumulative: true,
    receiptsToExpenses: true, advanceOffset: null, retentionPercent: null, sentAt: null, signedAt: null,
    signerName: null, signedOffline: false, addendumEstimateId: null, items: [], receipts: [],
    total: 0, receiptsTotal: 0, payable: 0, createdAt: '2026-08-14', updatedAt: '2026-08-14',
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
        estimateId: 'e1', estimateName: 'Чорнові', estimateCreatedAt: '2026-08-01', estimateItemId: 'i4', type: 'WORK',
        name: 'Ґрунтування стін', category: 'Стіни', unit: 'M2', unitPrice: 50,
        estimateQuantity: 30, done: 0, remaining: 30,
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
  // A DATA router (createMemoryRouter), not <MemoryRouter> — the editor's leave guard uses
  // useBlocker, which only exists there. The wildcard route is where a permitted exit lands.
  const router = createMemoryRouter(
    [
      { path: '/acts/:id', element: <ActEditorPage /> },
      { path: '*', element: <div>відкрито інший екран</div> },
    ],
    { initialEntries: [`/acts/a1${search}`] },
  );
  const view = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router };
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

  it('hidden MATERIAL lines are excluded from the total and from the saved items (WYSIWYG)', async () => {
    renderEditor();

    // Tick both the work line (66.5 × 145 = 9642.50) and the material line (100 × 20 = 2000).
    const workRow = (await screen.findByText('Шпаклювання стін')).closest('.rounded-card') as HTMLElement;
    fireEvent.click(within(workRow).getByRole('checkbox'));
    const materialRow = screen.getByText('Шпаклівка').closest('.rounded-card') as HTMLElement;
    fireEvent.click(within(materialRow).getByRole('checkbox'));
    // «Разом» and «До сплати» both show the figure — hence getAllBy.
    expect(screen.getAllByText(money(11642.5)).length).toBeGreaterThan(0); // both lines counted while visible

    // Untick «Показувати матеріали» — the hidden material must leave the total…
    fireEvent.click(screen.getByLabelText('Показувати матеріали'));
    expect(screen.queryAllByText(money(11642.5))).toHaveLength(0);
    expect(screen.getAllByText(money(9642.5)).length).toBeGreaterThan(0);

    // …and must NOT be saved: an invisible position can't be billed.
    fireEvent.click(screen.getByLabelText('Дії з актом'));
    fireEvent.click(await screen.findByText('Зберегти'));
    await waitFor(() => expect(actsApi.replaceItems).toHaveBeenCalled());
    const sent = vi.mocked(actsApi.replaceItems).mock.calls[0][1];
    expect(sent.items.map((i) => i.estimateItemId)).toEqual(['i1']);
  });

  it('signing an act with no lines is blocked with a hint instead of the modal', async () => {
    renderEditor();
    await screen.findByText('Шпаклювання стін'); // nothing ticked — the act is empty

    fireEvent.click(screen.getByLabelText('Дії з актом'));
    fireEvent.click(await screen.findByText('Підписати'));

    expect(screen.queryByText('Підписання акта офлайн')).toBeNull();
    const { toast } = await import('@/hooks/useToast.ts');
    expect(vi.mocked(toast.info)).toHaveBeenCalled();
  });

  it('a fully closed line is not offered again — finished work leaves the picker', async () => {
    const done = progress();
    done.lines[0] = { ...done.lines[0], done: 136.5, remaining: 0 };
    vi.mocked(actsApi.progress).mockResolvedValue(done);
    renderEditor();

    await screen.findByText('Ґрунтування стін'); // its still-open neighbour renders…
    expect(screen.queryByText('Шпаклювання стін')).toBeNull(); // …the closed line does not
  });

  it('an estimate whose every line is closed disappears whole', async () => {
    const done = progress();
    done.lines = done.lines.map((l) => (l.estimateId === 'e2' ? { ...l, done: 40, remaining: 0 } : l));
    vi.mocked(actsApi.progress).mockResolvedValue(done);
    renderEditor();

    await screen.findByText('Шпаклювання стін');
    expect(screen.queryByText('Чистові')).toBeNull(); // e2's group header is gone with its lines
    expect(screen.queryByText('Фарбування стель')).toBeNull();
  });

  it('the category checkbox selects the whole work stage in one tap, and clears it on the second', async () => {
    renderEditor('?scope=e1'); // «Стіни» has two lines (i1 + i4), «Матеріали» one
    await screen.findByText('Шпаклювання стін');

    // «Стіни» is also a title-suggestion chip (inside the name Field's label) — the group header
    // is the label that actually carries the group checkbox.
    const header = screen.getAllByText('Стіни')
      .map((el) => el.closest('label'))
      .find((el): el is HTMLLabelElement =>
        el !== null && el.querySelector('input[type="checkbox"]') !== null)!;
    fireEvent.click(within(header).getByRole('checkbox'));
    // 66.5 × 145 + 30 × 50 = 11 142.50 — the whole stage in one tap.
    expect(screen.getAllByText(money(11142.5)).length).toBeGreaterThan(0);

    fireEvent.click(within(header).getByRole('checkbox'));
    expect(screen.queryAllByText(money(11142.5))).toHaveLength(0);
  });

  it('auto-title: when every selected line shares one category, the act is named after it', async () => {
    renderEditor('?scope=e1');
    const row = (await screen.findByText('Шпаклювання стін')).closest('.rounded-card') as HTMLElement;
    fireEvent.click(within(row).getByRole('checkbox')); // only «Стіни» lines selected

    expect(screen.getByDisplayValue('Стіни')).toBeTruthy(); // the name field mirrors the stage

    fireEvent.click(screen.getByLabelText('Дії з актом'));
    fireEvent.click(await screen.findByText('Зберегти'));
    await waitFor(() => expect(actsApi.updateHeader).toHaveBeenCalled());
    expect(vi.mocked(actsApi.updateHeader).mock.calls[0][1].title).toBe('Стіни');
  });

  it('leaving with unsaved edits asks first; «Вийти без збереження» then leaves', async () => {
    renderEditor();

    // Make the form dirty: tick a line.
    const row = (await screen.findByText('Шпаклювання стін')).closest('.rounded-card') as HTMLElement;
    fireEvent.click(within(row).getByRole('checkbox'));

    fireEvent.click(screen.getByLabelText('Назад'));
    expect(await screen.findByText('Незбережені зміни')).toBeTruthy(); // blocked, dialog shown
    expect(screen.getByText('Шпаклювання стін')).toBeTruthy(); // still on the editor

    fireEvent.click(screen.getByText('Вийти без збереження'));
    expect(await screen.findByText('відкрито інший екран')).toBeTruthy(); // proceed() let it through
  });

  it('a pristine editor leaves without any dialog', async () => {
    renderEditor();
    await screen.findByText('Шпаклювання стін'); // seeded, nothing touched

    fireEvent.click(screen.getByLabelText('Назад'));

    expect(await screen.findByText('відкрито інший екран')).toBeTruthy();
    expect(screen.queryByText('Незбережені зміни')).toBeNull();
  });

  it('warns when an additional line duplicates a position from another signed estimate', async () => {
    renderEditor('?scope=e1'); // e2 hidden, but its «Фарбування стель» still triggers the warning
    await screen.findByText('Шпаклювання стін');

    fireEvent.click(screen.getByText('+ Додати роботу'));
    const nameField = screen.getByPlaceholderText('Почни вводити — підкажемо з каталогу');
    fireEvent.change(nameField, { target: { value: 'Фарбування стель' } });

    expect(await screen.findByText(/вже є в кошторисі «Чистові»/)).toBeTruthy();
  });

  it('lists the act receipts, their subtotal, and bills them on top of the works', async () => {
    // The master's ask: «чек1 — сума, чек2 — сума, разом», added to what the act is worth.
    vi.mocked(actsApi.get).mockResolvedValue({
      ...draftAct(),
      receipts: [
        { id: 'r1', label: 'Епіцентр — клей', amount: 2400, issuedAt: '2026-08-03', hasPhoto: true, sortOrder: 0 },
        { id: 'r2', label: 'Нова Пошта', amount: 600, issuedAt: null, hasPhoto: false, sortOrder: 1 },
      ],
      receiptsTotal: 3000,
    });
    renderEditor();

    expect(await screen.findByText('Епіцентр — клей')).toBeTruthy();
    expect(screen.getByText('Нова Пошта')).toBeTruthy();
    // Works 0 + receipts 3 000 → «До сплати» carries them; the subtotal row spells them out.
    expect(screen.getAllByText(money(3000)).length).toBeGreaterThanOrEqual(2);
  });

  it('saves from the button on the screen itself, not only from the FAB', async () => {
    // Master feedback: leaving the editor to hunt for «Зберегти» in the FAB was the loudest
    // complaint about this screen — the top bar keeps it one tap away while scrolling.
    renderEditor();
    const row = (await screen.findByText('Шпаклювання стін')).closest('.rounded-card') as HTMLElement;
    fireEvent.click(within(row).getByRole('checkbox'));

    fireEvent.click(screen.getByRole('button', { name: /Зберегти/ }));

    await waitFor(() => expect(actsApi.replaceItems).toHaveBeenCalled());
    expect(actsApi.updateHeader).toHaveBeenCalled();
  });

  it('shares an open act from its own screen', async () => {
    // «Поділитися з клієнтом» used to exist only on the object's Акти tab (master feedback).
    renderEditor();
    await screen.findByText('Шпаклювання стін');

    fireEvent.click(screen.getByLabelText('Поділитися з клієнтом'));

    expect(await screen.findByDisplayValue(/\?a=TOK/)).toBeTruthy();
  });
});
