import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { TemplatePickerSheet, type TemplatePick } from './TemplatePickerSheet.tsx';
import { estimateTemplatesApi } from '@/api/estimateTemplates.ts';
import type { EstimateTemplateDetail, EstimateTemplateSummary } from '@/api/types.ts';

vi.mock('@/api/estimateTemplates.ts', () => ({
  estimateTemplatesApi: {
    list: vi.fn(),
    get: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
  },
}));

const own: EstimateTemplateSummary = {
  id: 'own1', name: 'Моя ванна', trade: null, customTradeId: null, customTradeName: null, isDefault: false, itemCount: 3,
};
const def: EstimateTemplateSummary = {
  id: 'def1', name: 'Санвузол повний', trade: 'TILING', customTradeId: null, customTradeName: null, isDefault: true, itemCount: 8,
};

function renderPicker(onPick: (picks: TemplatePick[]) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<TemplatePickerSheet open onClose={() => {}} onPick={onPick} />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The toggle half of a row. Not `getByRole('button', { name })` — the row holds TWO buttons whose
 * accessible names both contain the template name (the toggle and the preview chevron), so a name
 * query is ambiguous; and `aria-pressed` flips between taps, so it cannot pin the element either.
 */
function toggleFor(name: string): HTMLElement {
  const button = screen.getByText(name).closest('button');
  if (!button) throw new Error(`no toggle button for ${name}`);
  return button;
}

describe('TemplatePickerSheet', () => {
  it('lists my templates and the defaults, and previews → picks one', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own, def]);
    const detail: EstimateTemplateDetail = {
      id: 'def1', name: 'Санвузол повний', trade: 'TILING', customTradeId: null, customTradeName: null, isDefault: true,
      items: [{ id: 'ti1', name: 'Грунтовка поверхонь', type: 'WORK', unit: 'M2', sortOrder: 0 }],
    };
    vi.mocked(estimateTemplatesApi.get).mockResolvedValue(detail);
    const onPick = vi.fn();

    renderPicker(onPick);

    // Both my own and the default template show up.
    expect(await screen.findByText('Моя ванна')).toBeTruthy();
    expect(screen.getByText('Санвузол повний')).toBeTruthy();

    // The chevron opens the preview → the template's positions are fetched and listed.
    fireEvent.click(screen.getByRole('button', { name: /Переглянути склад: Санвузол повний/ }));
    expect(await screen.findByText('Грунтовка поверхонь')).toBeTruthy();

    // Selecting from the preview returns to the list; applying is the footer's job. Nothing was
    // unticked, so the bundle travels whole (`itemIds: null`) — a subset frozen at "all of it"
    // would silently drop a position added to the bundle tomorrow.
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Створити кошторис (1)' }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith([{ template: def, itemIds: null }]));
  });

  it('takes only the positions ticked in the preview, and remembers them', async () => {
    // «деколи із великого шаблону треба 5-6 позицій і це довго потім викидати» — the master
    // narrows the bundle here instead of deleting lines out of the estimate afterwards.
    // Its own summary, so the row's «обрано N з M» and the preview's agree about M.
    const three: EstimateTemplateSummary = { ...def, itemCount: 3 };
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own, three]);
    vi.mocked(estimateTemplatesApi.get).mockResolvedValue({
      id: 'def1', name: 'Санвузол повний', trade: 'TILING', customTradeId: null, customTradeName: null,
      isDefault: true,
      items: [
        { id: 'ti1', name: 'Грунтовка поверхонь', type: 'WORK', unit: 'M2', sortOrder: 0 },
        { id: 'ti2', name: 'Гідроізоляція', type: 'WORK', unit: 'M2', sortOrder: 1 },
        { id: 'ti3', name: 'Укладання плитки', type: 'WORK', unit: 'M2', sortOrder: 2 },
      ],
    } satisfies EstimateTemplateDetail);
    const onPick = vi.fn();
    renderPicker(onPick);

    await screen.findByText('Санвузол повний');
    fireEvent.click(screen.getByRole('button', { name: /Переглянути склад: Санвузол повний/ }));

    // Everything starts ticked — narrowing is opt-in, not a chore the master has to do first.
    expect(await screen.findByText('Обрано 3 з 3')).toBeTruthy();
    fireEvent.click(screen.getByText('Гідроізоляція'));
    expect(screen.getByText('Обрано 2 з 3')).toBeTruthy();

    // «Готово» both stores the subset and ticks the bundle — a preview the master narrowed is a
    // bundle they want.
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(await screen.findByText('Обрано 2 з 3')).toBeTruthy(); // now on the row itself

    // Reopening the preview shows the same ticks back — «щось типу запамятати вибране».
    fireEvent.click(screen.getByRole('button', { name: /Переглянути склад: Санвузол повний/ }));
    expect(await screen.findByText('Обрано 2 з 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Створити кошторис (1)' }));
    await waitFor(() =>
      expect(onPick).toHaveBeenCalledWith([{ template: three, itemIds: ['ti1', 'ti3'] }]));
  });

  it('drops the bundle from the selection when every position is unticked', async () => {
    // A bundle that would contribute nothing is not something the master can mean — so unticking
    // the last position is the same answer as untapping the bundle.
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own, def]);
    vi.mocked(estimateTemplatesApi.get).mockResolvedValue({
      id: 'def1', name: 'Санвузол повний', trade: 'TILING', customTradeId: null, customTradeName: null,
      isDefault: true,
      items: [{ id: 'ti1', name: 'Грунтовка поверхонь', type: 'WORK', unit: 'M2', sortOrder: 0 }],
    } satisfies EstimateTemplateDetail);
    renderPicker(vi.fn());

    await screen.findByText('Санвузол повний');
    fireEvent.click(toggleFor('Санвузол повний'));
    expect(await screen.findByRole('button', { name: 'Створити кошторис (1)' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Переглянути склад: Санвузол повний/ }));
    fireEvent.click(await screen.findByText('Грунтовка поверхонь'));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Створити кошторис/ })).toBeNull());
  });

  it('applies several bundles at once, in the order they were tapped', async () => {
    // A real job is rarely one bundle — this is the whole point of the multi-select.
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own, def]);
    const onPick = vi.fn();
    renderPicker(onPick);

    await screen.findByText('Санвузол повний');
    fireEvent.click(toggleFor('Санвузол повний'));
    fireEvent.click(toggleFor('Моя ванна'));
    fireEvent.click(await screen.findByRole('button', { name: 'Створити кошторис (2)' }));

    // Tap order decides which bundle's wording survives a duplicate, so it must be preserved.
    await waitFor(() =>
      expect(onPick).toHaveBeenCalledWith([
        { template: def, itemIds: null },
        { template: own, itemIds: null },
      ]));
  });

  it('untaps a template, and the footer disappears with nothing selected', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own, def]);
    renderPicker(vi.fn());

    await screen.findByText('Моя ванна');
    fireEvent.click(toggleFor('Моя ванна'));
    expect(await screen.findByRole('button', { name: 'Створити кошторис (1)' })).toBeTruthy();

    fireEvent.click(toggleFor('Моя ванна'));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Створити кошторис/ })).toBeNull());
  });

  it('filters a long default list by name, and keeps what is already ticked', async () => {
    // A master with one busy trade has 20+ bundles — the search box exists because that is a long
    // scroll. The filter must be a VIEW: a bundle ticked before searching still counts.
    const many: EstimateTemplateSummary[] = Array.from({ length: 12 }, (_, i) => ({
      id: `d${i}`, name: `Кладка ${i}`, trade: 'BUILDER', customTradeId: null, customTradeName: null, isDefault: true, itemCount: 5,
    }));
    many.push({
      id: 'fence', name: 'Паркан профнастил', trade: 'BUILDER', customTradeId: null, customTradeName: null,
      isDefault: true, itemCount: 4,
    });
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own, ...many]);
    const onPick = vi.fn();
    renderPicker(onPick);

    await screen.findByText('Паркан профнастил');
    fireEvent.click(toggleFor('Кладка 0'));

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'паркан' } });

    await waitFor(() => expect(screen.queryByText('Кладка 0')).toBeNull());
    expect(screen.getByText('Паркан профнастил')).toBeTruthy();
    // Ticked while hidden by the filter — still selected, still counted.
    expect(screen.getByRole('button', { name: 'Створити кошторис (1)' })).toBeTruthy();

    fireEvent.click(toggleFor('Паркан профнастил'));
    fireEvent.click(screen.getByRole('button', { name: 'Створити кошторис (2)' }));
    await waitFor(() =>
      expect(onPick).toHaveBeenCalledWith([
        { template: many[0], itemIds: null },
        { template: many[many.length - 1], itemIds: null },
      ]));
  });

  it('says "nothing found" rather than "you have no templates" while searching', async () => {
    // The empty-state texts claim the master saved nothing / has no bundles. Under a filter that
    // is a lie, and a scary one — it reads as data loss.
    const many: EstimateTemplateSummary[] = Array.from({ length: 12 }, (_, i) => ({
      id: `d${i}`, name: `Кладка ${i}`, trade: 'BUILDER', customTradeId: null, customTradeName: null, isDefault: true, itemCount: 5,
    }));
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own, ...many]);
    renderPicker(vi.fn());

    await screen.findByText('Кладка 0');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'абракадабра' } });

    await waitFor(() => expect(screen.queryAllByText(/Нічого не знайдено/).length).toBe(2));
    expect(screen.queryByText(/не зберегли жодного шаблону/)).toBeNull();
    expect(screen.queryByText(/Немає доступних шаблонів/)).toBeNull();
  });

  it('hides the search box for a list short enough to just read', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own, def]);
    renderPicker(vi.fn());

    await screen.findByText('Санвузол повний');
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('shows the empty-state hint when there are no own templates', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([def]);
    renderPicker(vi.fn());

    expect(await screen.findByText(/не зберегли жодного шаблону/i)).toBeTruthy();
  });
});

/**
 * V121 — the picker is where the master chooses a finish LEVEL, and «Q3+» versus «Q4» is a choice
 * he cannot make off the name alone. The paragraph is one tap away in the list and spelled out in
 * the preview; it is never inline in the row, which is what made the estimate board flow sideways.
 */
describe('TemplatePickerSheet — what a bundle promises', () => {
  const Q4 = 'Q4 — під глянець і бокове світло. Допуск: без слідів інструменту.';

  it('keeps the paragraph behind an (i) in the row, and spells it out in the preview', async () => {
    const level: EstimateTemplateSummary = { ...def, id: 'q4', name: 'Підготовка ГКЛ · Q4', description: Q4 };
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([level]);
    vi.mocked(estimateTemplatesApi.get).mockResolvedValue({
      id: 'q4', name: 'Підготовка ГКЛ · Q4', description: Q4, trade: 'DRYWALL',
      customTradeId: null, customTradeName: null, isDefault: true,
      items: [{ id: 'ti1', name: 'Грунтування', type: 'WORK', unit: 'M2', sortOrder: 0 }],
    });

    renderPicker(vi.fn());

    expect(await screen.findByText('Підготовка ГКЛ · Q4')).toBeTruthy();
    expect(screen.queryByText(Q4)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Підготовка ГКЛ · Q4' }));
    expect(await screen.findByText(Q4)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Переглянути склад/ }));
    await waitFor(() => expect(screen.getByText('Грунтування')).toBeTruthy());
    expect(screen.getAllByText(Q4).length).toBeGreaterThan(0);
  });

  it('shows no (i) for a bundle that is just a list of jobs', async () => {
    vi.mocked(estimateTemplatesApi.list).mockResolvedValue([own]);
    const { container } = renderPicker(vi.fn());

    expect(await screen.findByText('Моя ванна')).toBeTruthy();
    expect(container.querySelectorAll('[aria-haspopup="dialog"]')).toHaveLength(0);
  });
});
