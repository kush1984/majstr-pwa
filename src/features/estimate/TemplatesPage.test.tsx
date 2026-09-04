import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { TemplatesPage } from './TemplatesPage.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { estimateTemplatesApi } from '@/api/estimateTemplates.ts';
import { catalogApi } from '@/api/catalog.ts';
import type {
  CatalogItemResponse,
  EstimateTemplateDetail,
  EstimateTemplateSummary,
  UserResponse,
} from '@/api/types.ts';
import { aUser } from '@/test/factories.ts';
import { asButton } from '@/test/dom.ts';

vi.mock('@/api/estimateTemplates.ts', () => ({
  estimateTemplatesApi: {
    list: vi.fn(),
    get: vi.fn(),
    rename: vi.fn(),
    setTrade: vi.fn(),
    remove: vi.fn(),
    addItem: vi.fn(),
    removeItem: vi.fn(),
    updateItem: vi.fn(),
    reorderItems: vi.fn(),
    restoreDefaults: vi.fn(),
  },
}));
vi.mock('@/api/catalog.ts', () => ({
  catalogApi: { list: vi.fn(), create: vi.fn(), categories: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const me: UserResponse = aUser();
const own: EstimateTemplateSummary = {
  id: 'own1', name: 'Моя ванна', trade: null, customTradeId: null, customTradeName: null, isDefault: false, itemCount: 1,
};
const ownDetail: EstimateTemplateDetail = {
  id: 'own1', name: 'Моя ванна', trade: null, customTradeId: null, customTradeName: null, isDefault: false,
  items: [{ id: 'it1', name: 'Розетка', type: 'WORK', unit: 'PIECE', sortOrder: 0 }],
};
const catalog: CatalogItemResponse[] = [
  // already in the template by name → must be disabled in the picker
  { id: 'c1', name: 'Розетка', category: 'Електрика', trade: 'ELECTRICAL', customTradeId: null, customTradeName: null, type: 'WORK', unit: 'PIECE', defaultPrice: 180, sortOrder: 0, createdAt: '' },
  // fresh → selectable
  { id: 'c2', name: 'Кабель ВВГ', category: 'Кабель', trade: 'ELECTRICAL', customTradeId: null, customTradeName: null, type: 'MATERIAL', unit: 'M', defaultPrice: 38.5, sortOrder: 0, createdAt: '' },
];

function renderPage(meOverride: UserResponse = me) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, meOverride);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<TemplatesPage />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(catalogApi.categories).mockResolvedValue([]);
});

describe('TemplatesPage — edit own template', () => {
  it('pencil opens the editor; catalog picker skips present items and adds a fresh one', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own]);
    vi.mocked(estimateTemplatesApi.get).mockResolvedValue(ownDetail);
    vi.mocked(catalogApi.list).mockResolvedValue(catalog);
    vi.mocked(estimateTemplatesApi.addItem).mockResolvedValue(ownDetail);

    renderPage();

    // The own template is listed; the pencil opens the full editor (not just rename).
    expect(await screen.findByText('Моя ванна')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Редагувати' }));
    expect(await screen.findByText('Редагувати шаблон')).toBeTruthy();

    // Catalog tab is default: both rows render; the one already in the template is disabled.
    const rows = (await screen.findAllByTestId('catalog-row'));
    expect(rows).toHaveLength(2);
    const presentRow = rows.find((r) => r.textContent?.includes('Розетка'))!;
    const freshRow = rows.find((r) => r.textContent?.includes('Кабель ВВГ'))!;
    expect(asButton(presentRow).disabled).toBe(true);
    expect(asButton(freshRow).disabled).toBe(false);

    // Select the fresh one → add. It lands in the DRAFT and nothing is written yet: the whole
    // point of the explicit save is that the master can try positions on before committing.
    fireEvent.click(freshRow);
    fireEvent.click(screen.getByRole('button', { name: /Додати 1/ }));
    await waitFor(() => expect(screen.getAllByText('Кабель ВВГ').length).toBe(2));
    expect(estimateTemplatesApi.addItem).not.toHaveBeenCalled();

    // «Зберегти» is what writes — and it only became enabled because the draft changed.
    fireEvent.click(screen.getByTestId('template-save'));
    await waitFor(() =>
      // Third arg = the client-generated UUID that makes the add idempotent on replay.
      expect(estimateTemplatesApi.addItem).toHaveBeenCalledWith('own1', {
        name: 'Кабель ВВГ', type: 'MATERIAL', unit: 'M',
      }, expect.any(String)),
    );
  });

  it('manual add → offers to save the new position to the catalog', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own]);
    vi.mocked(estimateTemplatesApi.get).mockResolvedValue(ownDetail);
    vi.mocked(catalogApi.list).mockResolvedValue([]);
    vi.mocked(estimateTemplatesApi.addItem).mockResolvedValue(ownDetail);
    vi.mocked(catalogApi.create).mockResolvedValue({
      id: 'cN', name: 'Нова робота', category: null, trade: null, type: 'WORK',
      unit: 'M2', defaultPrice: 0, sortOrder: 0, createdAt: '',
    } as never);

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Редагувати' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Вручну' }));
    fireEvent.change(screen.getByPlaceholderText('Назва позиції'), {
      target: { value: 'Нова робота' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Додати позицію' }));

    // The position is in the draft and the save-to-catalog prompt appears. The CATALOG entry is
    // a separate thing the master owns, so it is offered right away; the TEMPLATE is not written.
    expect(await screen.findByText(/у ваш каталог/)).toBeTruthy();
    expect(estimateTemplatesApi.addItem).not.toHaveBeenCalled();

    // Confirm → catalog entry created with name/type/unit + empty price (0).
    fireEvent.click(screen.getByRole('button', { name: 'Додати в каталог' }));
    await waitFor(() =>
      expect(catalogApi.create).toHaveBeenCalledWith({
        name: 'Нова робота', category: undefined, trade: 'OTHER',
        type: 'WORK', unit: 'M2', defaultPrice: 0,
      }, expect.any(String)),
    );
  });

  it('row tap opens a read-only preview (no edit controls)', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own]);
    vi.mocked(estimateTemplatesApi.get).mockResolvedValue(ownDetail);

    renderPage();

    fireEvent.click(await screen.findByText('Моя ванна'));
    // The composition shows...
    expect(await screen.findByText('Розетка')).toBeTruthy();
    // ...but there is no "add position" control in read-only preview.
    expect(screen.queryByText('Додати позицію')).toBeNull();
  });

  it('re-files a SYSTEM template into another trade from the preview (own setting)', async () => {
    const sys: EstimateTemplateSummary = {
      id: 's1', name: 'ГІПСОКАРТОН', trade: 'DRYWALL', customTradeId: null, customTradeName: null, isDefault: true, itemCount: 5,
    };
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([sys]);
    vi.mocked(estimateTemplatesApi.get).mockResolvedValue({
      id: 's1', name: 'ГІПСОКАРТОН', trade: 'DRYWALL', customTradeId: null, customTradeName: null, isDefault: true, items: [],
    });
    vi.mocked(estimateTemplatesApi.setTrade).mockResolvedValue({ ...sys, trade: 'PAINTER' });

    renderPage();
    fireEvent.click(await screen.findByText('ГІПСОКАРТОН'));

    // The trade select in the preview → move to a different trade.
    const select = await screen.findByDisplayValue(/Гіпсокартон/);
    fireEvent.change(select, { target: { value: 'PAINTER' } });

    await waitFor(() => expect(estimateTemplatesApi.setTrade).toHaveBeenCalledWith(
      's1', { trade: 'PAINTER', customTradeId: null }));
  });

  it('re-files MY OWN template into a custom trade — the picker offers it, a system default would not', async () => {
    const meWithCustom = aUser({ customTrades: [{ id: 'ct1', name: 'Натяжні стелі', sortOrder: 0 }] });
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own]);
    vi.mocked(estimateTemplatesApi.get).mockResolvedValue(ownDetail);
    vi.mocked(estimateTemplatesApi.setTrade).mockResolvedValue({
      ...own, trade: 'OTHER', customTradeId: 'ct1', customTradeName: 'Натяжні стелі',
    });

    renderPage(meWithCustom);
    fireEvent.click(await screen.findByText('Моя ванна'));

    const select = await screen.findByRole('combobox');
    expect(screen.getByText(/Натяжні стелі/)).toBeTruthy();
    fireEvent.change(select, { target: { value: 'custom:ct1' } });

    await waitFor(() => expect(estimateTemplatesApi.setTrade).toHaveBeenCalledWith(
      'own1', { trade: null, customTradeId: 'ct1' }));
  });
});

describe('TemplatesPage — trade is a level, not a filter', () => {
  const defaults: EstimateTemplateSummary[] = [
    { id: 'd1', name: 'Електрика квартири', trade: 'ELECTRICAL', customTradeId: null, customTradeName: null, isDefault: true, itemCount: 3 },
    { id: 'd2', name: 'Санвузол сантехніка', trade: 'PLUMBING', customTradeId: null, customTradeName: null, isDefault: true, itemCount: 4 },
  ];

  it('shows every trade at once and collapses one without hiding the others', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own, ...defaults]);

    renderPage();

    // The whole point of the tree over the chips: nothing is filtered away to begin with.
    expect(await screen.findByText('Електрика квартири')).toBeTruthy();
    expect(screen.getByText('Санвузол сантехніка')).toBeTruthy();

    // Shut the plumbing branch (capital С matches the branch header, not the lowercase row
    // name) → its bundle folds away and the OTHER trade stays on screen.
    fireEvent.click(screen.getByRole('button', { name: /Сантехніка/ }));
    await waitFor(() => expect(screen.queryByText('Санвузол сантехніка')).toBeNull());
    expect(screen.getByText('Електрика квартири')).toBeTruthy();
  });

  it('draws no trade level for a section that holds a single trade', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own, defaults[0]]);

    renderPage();

    expect(await screen.findByText('Моя ванна')).toBeTruthy();
    // One branch per section here — a level with nothing to disambiguate is not drawn, the same
    // rule the chips had (they hid themselves under two trades).
    expect(screen.queryAllByTestId('templates-trade')).toHaveLength(0);
  });

  it('keeps the two sections apart: opening a trade in one leaves its twin in the other alone', async () => {
    const ownPlumbing: EstimateTemplateSummary = {
      id: 'own2', name: 'Моя сантехніка', trade: 'PLUMBING', customTradeId: null, customTradeName: null, isDefault: false, itemCount: 2,
    };
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own, ownPlumbing, ...defaults]);

    renderPage();

    expect(await screen.findByText('Моя сантехніка')).toBeTruthy();
    // «Сантехніка» is a branch in BOTH «Мої» and «Готові». One shared open key would fold them
    // together, which is why the state is keyed per section.
    const plumbing = screen.getAllByRole('button', { name: /Сантехніка/ });
    expect(plumbing).toHaveLength(2);
    fireEvent.click(plumbing[0]);
    await waitFor(() => expect(screen.queryByText('Моя сантехніка')).toBeNull());
    expect(screen.getByText('Санвузол сантехніка')).toBeTruthy();
  });
});

describe('TemplatesPage — ready-made templates are editable too', () => {
  const sys: EstimateTemplateSummary = {
    id: 'd1', name: 'МАЛЯРНІ РОБОТИ', trade: 'PAINTER', customTradeId: null, customTradeName: null, isDefault: true, itemCount: 2,
  };
  const sysDetail: EstimateTemplateDetail = {
    id: 'd1', name: 'МАЛЯРНІ РОБОТИ', trade: 'PAINTER', customTradeId: null, customTradeName: null, isDefault: true,
    items: [
      { id: 'i1', name: 'Грунтування стін', type: 'WORK', unit: 'M2', sortOrder: 0 },
      { id: 'i2', name: 'Фарбування стін', type: 'WORK', unit: 'M2', sortOrder: 1 },
    ],
  };

  it('deleting a system default asks to HIDE it, not to delete it for everyone', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([sys]);
    vi.mocked(estimateTemplatesApi.remove).mockResolvedValue(undefined);

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Видалити' }));
    // The wording is the whole point: the row is shared by every master, so it only leaves MY list.
    expect(await screen.findByText('Прибрати шаблон зі списку?')).toBeTruthy();
    expect(screen.getByText(/зникне лише у вас/)).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Видалити' })
      .find((b) => !asButton(b).disabled && b.textContent === 'Видалити')!);
    await waitFor(() => expect(estimateTemplatesApi.remove).toHaveBeenCalledWith('d1'));
  });

  it('the first edit of a ready-made template follows the fork the server answers with', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([sys]);
    vi.mocked(estimateTemplatesApi.get).mockResolvedValue(sysDetail);
    vi.mocked(catalogApi.list).mockResolvedValue([]);
    // The server copied the shared bundle into the master's own — a DIFFERENT id comes back.
    vi.mocked(estimateTemplatesApi.addItem).mockResolvedValue({ ...sysDetail, id: 'fork1', isDefault: false });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Редагувати' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Вручну' }));
    fireEvent.change(screen.getByPlaceholderText('Назва позиції'), {
      target: { value: 'Шліфування стін' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Додати позицію' }));
    fireEvent.click(await screen.findByTestId('template-save'));

    await waitFor(() => expect(estimateTemplatesApi.addItem).toHaveBeenCalledWith('d1', {
      name: 'Шліфування стін', type: 'WORK', unit: 'M2',
    }, expect.any(String)));
    // ...and the editor re-points at the copy, or the next refetch would hand back the pristine
    // default and the edits would look like they vanished.
    await waitFor(() => expect(estimateTemplatesApi.get).toHaveBeenCalledWith('fork1'));
  });

  it('a save EDITS the template — the ready-made one is copied once, never on every save', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([sys]);
    vi.mocked(catalogApi.list).mockResolvedValue([]);
    vi.mocked(estimateTemplatesApi.rename).mockResolvedValue({
      ...sys, id: 'fork1', name: 'Малярка моя', isDefault: false,
    });
    vi.mocked(estimateTemplatesApi.get).mockResolvedValue(sysDetail);

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Редагувати' }));

    // First save: rename → the server forks the shared bundle and answers with the copy.
    expect(await screen.findByText(/Грунтування стін/)).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue('МАЛЯРНІ РОБОТИ'), { target: { value: 'Малярка моя' } });
    fireEvent.click(screen.getByTestId('template-save'));
    await waitFor(() =>
      expect(estimateTemplatesApi.rename).toHaveBeenCalledWith('d1', { name: 'Малярка моя' }));

    // Second save, still in the same editor: it addresses fork1 and creates nothing new.
    // Renaming is the only write that could plausibly mint a row, so it is the one worth pinning.
    fireEvent.change(await screen.findByDisplayValue('Малярка моя'),
      { target: { value: 'Малярка моя 2' } });
    fireEvent.click(screen.getByTestId('template-save'));

    await waitFor(() =>
      expect(estimateTemplatesApi.rename).toHaveBeenCalledWith('fork1', { name: 'Малярка моя 2' }));
    expect(vi.mocked(estimateTemplatesApi.rename).mock.calls).toHaveLength(2);
  });

  it('an added position is marked unsaved and scrolled to, and goes plain again once saved', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([sys]);
    vi.mocked(estimateTemplatesApi.get).mockResolvedValue(sysDetail);
    vi.mocked(catalogApi.list).mockResolvedValue([]);
    vi.mocked(estimateTemplatesApi.addItem).mockResolvedValue(sysDetail);
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Редагувати' }));
    expect(await screen.findByText(/Грунтування стін/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Вручну' }));
    fireEvent.change(screen.getByPlaceholderText('Назва позиції'), {
      target: { value: 'Шліфування стін' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Додати позицію' }));

    // Scoped to the composition — the name also shows up in the «зберегти в каталог» prompt the
    // manual form leaves open behind it.
    const card = (name: string) =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-template-item-id] button'))
        .find((el) => el.textContent?.includes(name));

    // A bundle is longer than the list shows and a new position lands at the BOTTOM, so it is
    // brought into view — otherwise the highlight is on a row nobody can see.
    await waitFor(() => expect(card('Шліфування стін')).toBeTruthy());
    expect(scrolled).toHaveBeenCalled();

    // Highlighted because it is not on the server yet — the untouched rows are not.
    expect(card('Шліфування стін')!.className).toContain('bg-success-soft');
    expect(card('Грунтування стін')!.className).not.toContain('bg-success-soft');

    // «Зберегти» writes it, so the "not saved yet" mark goes out on its own.
    fireEvent.click(screen.getByTestId('template-save'));
    await waitFor(() => expect(estimateTemplatesApi.addItem).toHaveBeenCalled());
    await waitFor(() => expect(card('Шліфування стін')!.className).not.toContain('bg-success-soft'));
  });

  it('closing with unsaved changes asks, and «Не зберігати» writes nothing', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([sys]);
    vi.mocked(estimateTemplatesApi.get).mockResolvedValue(sysDetail);
    vi.mocked(catalogApi.list).mockResolvedValue([]);

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Редагувати' }));

    // Remove a position — a draft change like any other.
    fireEvent.click((await screen.findAllByRole('button', { name: 'Прибрати позицію' }))[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Видалити' })
      .find((b) => b.textContent === 'Видалити')!);
    await waitFor(() => expect(screen.queryByText(/Грунтування стін/)).toBeNull());

    // ✕ must not drop the rework on the floor.
    fireEvent.click(screen.getAllByRole('button', { name: 'Закрити' })[0]);
    expect(await screen.findByText('Зберегти зміни?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Не зберігати' }));
    await waitFor(() => expect(screen.queryByText('Редагувати шаблон')).toBeNull());
    expect(estimateTemplatesApi.removeItem).not.toHaveBeenCalled();
    expect(estimateTemplatesApi.rename).not.toHaveBeenCalled();
  });

  it('tapping a position opens the editor for it and saves name/type/unit in place', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([sys]);
    vi.mocked(estimateTemplatesApi.get).mockResolvedValue(sysDetail);
    vi.mocked(catalogApi.list).mockResolvedValue([]);
    vi.mocked(estimateTemplatesApi.updateItem).mockResolvedValue(sysDetail);

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Редагувати' }));

    // The composition is numbered — the order is the sequence of works, not decoration.
    expect(await screen.findByText(/Грунтування стін/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Фарбування стін/));

    expect(await screen.findByText('Редагувати позицію')).toBeTruthy();
    // Opens prefilled with what is already there — an edit starts from the current wording.
    const nameInput = screen.getByPlaceholderText<HTMLInputElement>('Назва позиції');
    expect(nameInput.value).toBe('Фарбування стін');
    fireEvent.change(nameInput, { target: { value: 'Фарбування стін у 2 шари' } });

    // The sheet's «Зберегти» only closes it onto the draft — the template is still untouched.
    fireEvent.click(screen.getAllByRole('button', { name: 'Зберегти' })
      .find((b) => !b.getAttribute('data-testid'))!);
    await waitFor(() => expect(screen.queryByText('Редагувати позицію')).toBeNull());
    expect(estimateTemplatesApi.updateItem).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('template-save'));
    await waitFor(() => expect(estimateTemplatesApi.updateItem).toHaveBeenCalledWith('d1', 'i2', {
      name: 'Фарбування стін у 2 шари', type: 'WORK', unit: 'M2',
    }));
  });
});

/**
 * V121 — a finish level is a bundle, and the bundle explains itself to the client: «Q4» means
 * nothing to the person signing, so the paragraph the master writes here is copied onto every
 * estimate the bundle composes and printed under the client's table.
 */
describe('TemplatesPage — the paragraph the client reads', () => {
  const Q4 = 'Q4 — суцільне шпаклювання, під глянець і бокове світло.';
  const described: EstimateTemplateSummary = { ...own, description: Q4 };
  const describedDetail: EstimateTemplateDetail = { ...ownDetail, description: Q4 };

  it('offers the paragraph behind an (i) in the list, so a long one cannot push the row around', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([described]);
    renderPage();

    expect(await screen.findByText('Моя ванна')).toBeTruthy();
    expect(screen.queryByText(Q4)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Моя ванна' }));
    expect(await screen.findByText(Q4)).toBeTruthy();
  });

  it('writes it with «Зберегти», in the same call as the name', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own]);
    vi.mocked(estimateTemplatesApi.get).mockResolvedValue(ownDetail);
    vi.mocked(catalogApi.list).mockResolvedValue([]);
    vi.mocked(estimateTemplatesApi.rename).mockResolvedValue(described);

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Редагувати' }));

    const field = await screen.findByTestId('template-description');
    // Nothing is written while he types — this editor is explicit-save like the act editor.
    fireEvent.change(field, { target: { value: Q4 } });
    expect(estimateTemplatesApi.rename).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('template-save'));
    await waitFor(() => expect(estimateTemplatesApi.rename)
      .toHaveBeenCalledWith('own1', { name: 'Моя ванна', description: Q4 }));
    expect(estimateTemplatesApi.rename).toHaveBeenCalledTimes(1);
  });

  it('a rename alone sends no description — «absent» is what leaves it alone', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([described]);
    vi.mocked(estimateTemplatesApi.get).mockResolvedValue(describedDetail);
    vi.mocked(catalogApi.list).mockResolvedValue([]);
    vi.mocked(estimateTemplatesApi.rename).mockResolvedValue({ ...described, name: 'Ванна Q4' });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Редагувати' }));
    await screen.findByTestId('template-description');

    fireEvent.change(screen.getByDisplayValue('Моя ванна'), { target: { value: 'Ванна Q4' } });
    fireEvent.click(screen.getByTestId('template-save'));

    await waitFor(() => expect(estimateTemplatesApi.rename)
      .toHaveBeenCalledWith('own1', { name: 'Ванна Q4', description: undefined }));
  });
});
