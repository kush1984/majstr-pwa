import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ActEditorPage } from './ActEditorPage.tsx';
import { actsApi } from '@/api/acts.ts';
import { formatMoney, formatMoneyExact } from '@/lib/format.ts';
import { economyApi } from '@/api/economy.ts';
import type { ActProgressResponse, ObjectEconomyResponse, WorkActResponse } from '@/api/types.ts';

vi.mock('@/api/acts.ts', () => ({
  actsApi: {
    get: vi.fn(),
    progress: vi.fn(),
    create: vi.fn(() => Promise.resolve({ id: `a-new` } as WorkActResponse)),
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
// «Зараховано авансу» reads the object's own economy to say what it is FOR — money the client has
// already paid that no signed act has accepted yet. Mocked here so these tests own that number.
vi.mock('@/api/economy.ts', () => ({ economyApi: { economy: vi.fn() } }));

function money(n: number): string {
  return formatMoney(n).replace(/\s+/g, ' ');
}

/** The totals block prints kopecks (receipts round 2) — match it exactly. */
function moneyExact(n: number): string {
  return formatMoneyExact(n).replace(/\s+/g, ' ');
}

function draftAct(): WorkActResponse {
  return {
    id: 'a1', projectId: 'p1', number: '7', title: null, kind: 'INTERIM', status: 'DRAFT',
    issuedAt: '2026-08-14', periodFrom: '2026-08-01', periodTo: '2026-08-14',
    place: null, contractRef: null, note: null, showMaterials: true, showCumulative: true,
    receiptsToExpenses: true, showReceiptPhotos: true, advanceOffset: null, retentionPercent: null, sentAt: null, signedAt: null,
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

/**
 * The «/acts/new» editor: an act that has NO server row yet. Both routes are registered exactly as
 * in the app, so the static '/acts/new' outranks the dynamic '/acts/:id'.
 */
function renderNewEditor(search = '?project=p1&from=2026-08-01') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/acts/new', element: <ActEditorPage /> },
      { path: '/acts/:id', element: <ActEditorPage /> },
      { path: '*', element: <div>відкрито інший екран</div> },
    ],
    { initialEntries: [`/acts/new${search}`] },
  );
  const view = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router };
}

/** Only `acts` matters here — it is all the editor reads off the economy. */
function economy(acceptedByActs: number, received: number): ObjectEconomyResponse {
  return { estimates: [], acts: { contracted: 0, acceptedByActs, received }, payments: null, internals: null };
}

/** The advance input carries no label element — it is the textbox in «Зараховано авансу»'s block. */
function advanceInput(): HTMLElement {
  const block = screen.getByText('Зараховано авансу').closest('div')?.parentElement as HTMLElement;
  return within(block).getByRole('textbox');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(actsApi.get).mockResolvedValue(draftAct());
  vi.mocked(actsApi.progress).mockResolvedValue(progress());
  vi.mocked(economyApi.economy).mockResolvedValue(economy(0, 0));
});

describe('ActEditorPage (new act)', () => {
  it('opening «Новий акт» creates nothing — the act is born on «Зберегти»', async () => {
    renderNewEditor();

    // The editor is fully usable, off the query string alone: no GET, and above all no POST.
    await screen.findByText('Шпаклювання стін');
    expect(actsApi.get).not.toHaveBeenCalled();
    expect(actsApi.create).not.toHaveBeenCalled();
    expect(screen.getByText('Новий акт')).toBeTruthy(); // no number yet — the server mints it

    // The period start rides the query string (computed off the object's acts by the caller).
    expect(screen.getByDisplayValue('2026-08-01')).toBeTruthy();

    const row = (await screen.findByText('Шпаклювання стін')).closest('.rounded-card') as HTMLElement;
    fireEvent.click(within(row).getByRole('checkbox'));
    fireEvent.click(screen.getAllByText(/^Зберегти/)[0]);

    await waitFor(() => expect(actsApi.create).toHaveBeenCalledTimes(1));
    const [projectId, req, uuid] = vi.mocked(actsApi.create).mock.calls[0];
    expect(projectId).toBe('p1');
    expect(req.periodFrom).toBe('2026-08-01');
    expect(uuid).toBeTruthy(); // X-Entity-Uuid — a retried create must not double-number the object
    // Lines go on the row the create just answered with, not on the '' the URL carried.
    await waitFor(() => expect(actsApi.replaceItems).toHaveBeenCalledTimes(1));
    expect(vi.mocked(actsApi.replaceItems).mock.calls[0][0]).toBe('a-new');
    expect(vi.mocked(actsApi.replaceItems).mock.calls[0][1].items).toHaveLength(1);
  });

  it('receipts wait for the first save — there is no act row to attach a photo to', async () => {
    renderNewEditor();

    expect(await screen.findByText('Збережіть акт, щоб додати чеки та рахунки.')).toBeTruthy();
    // The panel itself IS titled before the first save — it says where receipts will live; what
    // must be absent is the section that can actually take one.
    expect(screen.queryByText('Чеків ще немає.')).toBeNull();
  });

  it('leaving an unsaved new act asks first, and says it will not be created', async () => {
    const { router } = renderNewEditor();

    await screen.findByText('Шпаклювання стін');
    // Nothing was even typed: an act with no server row behind it is unsaved by definition.
    fireEvent.click(screen.getByLabelText('Назад'));

    expect(await screen.findByText(/він не створиться/)).toBeTruthy();
    expect(router.state.location.pathname).toBe('/acts/new');

    fireEvent.click(screen.getByText('Вийти без збереження'));
    expect(await screen.findByText('відкрито інший екран')).toBeTruthy();
    expect(actsApi.create).not.toHaveBeenCalled();
  });
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
    expect(screen.getAllByText(moneyExact(11642.5)).length).toBeGreaterThan(0); // both lines counted while visible

    // Untick «Показувати матеріали» — the hidden material must leave the total…
    fireEvent.click(screen.getByLabelText('Показувати матеріали'));
    expect(screen.queryAllByText(moneyExact(11642.5))).toHaveLength(0);
    expect(screen.getAllByText(moneyExact(9642.5)).length).toBeGreaterThan(0);

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
    expect(screen.getAllByText(moneyExact(11142.5)).length).toBeGreaterThan(0);

    fireEvent.click(within(header).getByRole('checkbox'));
    expect(screen.queryAllByText(moneyExact(11142.5))).toHaveLength(0);
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
        { id: 'r1', label: 'Епіцентр — клей', amount: 2400, returnedAmount: 0, issuedAt: '2026-08-03', hasPhoto: true, itemized: false, sortOrder: 0 },
        { id: 'r2', label: 'Нова Пошта', amount: 600, returnedAmount: 0, issuedAt: null, hasPhoto: false, itemized: false, sortOrder: 1 },
      ],
      receiptsTotal: 3000,
    });
    renderEditor();

    expect(await screen.findByText('Епіцентр — клей')).toBeTruthy();
    expect(screen.getByText('Нова Пошта')).toBeTruthy();
    // Works 0 + receipts 3 000 → «До сплати» carries them; the subtotal row spells them out.
    expect(screen.getAllByText(moneyExact(3000)).length).toBeGreaterThanOrEqual(2);
  });

  it('a partial return reaches «До сплати», not just the receipts panel (V115)', async () => {
    // The editor computes its own receipts subtotal off the rows, so it has to net the return the
    // same way the panel and the server's `payable` do — or the master reads two different bills
    // on one screen.
    vi.mocked(actsApi.get).mockResolvedValue({
      ...draftAct(),
      receipts: [
        { id: 'r1', label: 'Цвяхи', amount: 2000, returnedAmount: 500, issuedAt: null, hasPhoto: true, itemized: false, sortOrder: 0 },
      ],
      receiptsTotal: 1500,
    });
    renderEditor();

    await screen.findByText('Цвяхи');
    // 1 500 twice (the panel's own subtotal + the settlement block), and the gross 2 000 never as a
    // total — it survives only on the row, where it says what the paper says.
    expect(screen.getAllByText(moneyExact(1500)).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(moneyExact(2000))).toBeNull();
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

  it('shares an open act from the FAB too, deep in a long editor', async () => {
    // The top bar scrolls away on a long act, and that is exactly where the master wanted to
    // share from (screenshot feedback: the actions sheet listed PDF/Підписати/Зберегти only).
    renderEditor();
    await screen.findByText('Шпаклювання стін');

    fireEvent.click(screen.getByLabelText('Дії з актом'));
    // Two buttons carry the name now — the top bar's icon-only 🔗 and the sheet's row; the sheet's
    // is the one rendered last.
    const share = screen.getAllByRole('button', { name: /Поділитися з клієнтом/ });
    fireEvent.click(share[share.length - 1]);

    expect(await screen.findByDisplayValue(/\?a=TOK/)).toBeTruthy();
  });
});

/**
 * «Зараховано авансу» used to be a bare number field whose meaning the master had to carry in his
 * head («отой аванс — то для мене поки загадка»). It now says what it is for in the object's own
 * numbers: the money the client paid ahead that no SIGNED act has accepted yet.
 */
describe('ActEditorPage — the advance field explains itself', () => {
  it('names the object\u2019s unearned advance and credits it in one tap', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(economy(4000, 14000)); // 10 000 ₴ paid ahead
    renderEditor();
    const row = (await screen.findByText('Шпаклювання стін')).closest('.rounded-card') as HTMLElement;
    fireEvent.click(within(row).getByRole('checkbox')); // full remainder: 66.5 × 145 = 9 642,50

    const apply = await screen.findByRole('button', { name: /Зарахувати/ });
    // Never more than this act is worth — the offer is min(unearned, act value), not the full 10 000.
    expect(apply.textContent?.replace(/\s+/g, ' ')).toContain(money(9642.5));
    fireEvent.click(apply);

    expect(screen.getByDisplayValue('9642.5')).toBeTruthy();
    // «До сплати» drops to what is left after the advance — the whole point of the field.
    const payable = screen.getByText('До сплати').parentElement as HTMLElement;
    expect(payable.textContent?.replace(/\s+/g, ' ')).toContain(moneyExact(0));
  });

  it('says plainly when there is no advance to credit', async () => {
    renderEditor(); // default economy: the client has paid nothing
    await screen.findByText('Шпаклювання стін');

    expect(await screen.findByText(/ще нічого не платив наперед/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Зарахувати/ })).toBeNull();
  });

  it('warns — but does not block — when more is credited than the client paid ahead', async () => {
    // The one thing nothing else catches: the same advance credited on two different acts.
    vi.mocked(economyApi.economy).mockResolvedValue(economy(4000, 5000)); // 1 000 ₴ unearned
    renderEditor();
    await screen.findByText('Шпаклювання стін');
    await screen.findByText(/Клієнт уже заплатив наперед/);

    fireEvent.change(advanceInput(), { target: { value: '3000' } });

    expect(screen.getByText(/Більше, ніж клієнт заплатив наперед/)).toBeTruthy();
    // A warning, not a gate: the value the master typed stands.
    expect(screen.getByDisplayValue('3000')).toBeTruthy();
  });
});
