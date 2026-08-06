import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { AddItemSheet } from './AddItemSheet.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { catalogApi } from '@/api/catalog.ts';
import { estimatesApi } from '@/api/estimates.ts';
import type { CatalogItemResponse, EstimateItemResponse, UserResponse } from '@/api/types.ts';
import { aUser, anEstimate } from '@/test/factories.ts';

vi.mock('@/api/catalog.ts', () => ({
  catalogApi: { list: vi.fn(), create: vi.fn(), categories: vi.fn(), search: vi.fn() },
}));
vi.mock('@/api/estimates.ts', () => ({
  estimatesApi: { addItemsFromCatalogBatch: vi.fn(), addItem: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const me: UserResponse = aUser();
const catalog: CatalogItemResponse[] = [
  { id: 'i1', name: 'Розетка', category: 'Електрика', trade: 'ELECTRICAL', type: 'WORK', unit: 'PIECE', defaultPrice: 180, sortOrder: 0, createdAt: '' },
  { id: 'i2', name: 'Кабель ВВГ', category: 'Кабель', trade: 'ELECTRICAL', type: 'MATERIAL', unit: 'M', defaultPrice: 38.5, sortOrder: 0, createdAt: '' },
];

function renderSheet(onClose: () => void, siblings: EstimateItemResponse[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, me);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <AddItemSheet estimateId="e1" nextSortOrder={5} siblings={siblings} open onClose={onClose} />,
    { wrapper },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(catalogApi.categories).mockResolvedValue([]);
  vi.mocked(catalogApi.search).mockResolvedValue([]);
});

describe('AddItemSheet — catalog multi-select', () => {
  it('selects several catalog items and adds them in one batch request', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue(catalog);
    vi.mocked(estimatesApi.addItemsFromCatalogBatch).mockResolvedValue(anEstimate());
    const onClose = vi.fn();

    renderSheet(onClose);

    // Both catalog rows show; tap to select two.
    const rows = await screen.findAllByTestId('catalog-row');
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[0]);
    fireEvent.click(rows[1]);

    // The sticky "add N" button appears and triggers ONE batch call with both.
    fireEvent.click(screen.getByRole('button', { name: /Додати 2/ }));
    // Each entry now also carries a client-generated id: the pick is authored offline-first,
    // and per-line ids let a partially-applied batch resume instead of duplicating what landed.
    await waitFor(() =>
      expect(estimatesApi.addItemsFromCatalogBatch).toHaveBeenCalledWith('e1', [
        { catalogItemId: 'i1', quantity: 1, sortOrder: 5, id: expect.any(String) },
        { catalogItemId: 'i2', quantity: 1, sortOrder: 6, id: expect.any(String) },
      ]),
    );
    const sent = vi.mocked(estimatesApi.addItemsFromCatalogBatch).mock.calls[0][1];
    expect(new Set(sent.map((e) => e.id)).size).toBe(2); // distinct, not one id reused
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('filters the catalog list by type (works / materials)', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue(catalog);
    renderSheet(vi.fn());

    // Default: both the work and the material show.
    expect(await screen.findAllByTestId('catalog-row')).toHaveLength(2);

    // "Матеріали" → only the MATERIAL (Кабель ВВГ) remains.
    fireEvent.click(screen.getByRole('button', { name: 'Матеріали' }));
    await waitFor(() => expect(screen.getAllByTestId('catalog-row')).toHaveLength(1));
    expect(screen.getByText('Кабель ВВГ')).toBeTruthy();
    expect(screen.queryByText('Розетка')).toBeNull();

    // "Роботи" → only the WORK (Розетка) remains.
    fireEvent.click(screen.getByRole('button', { name: 'Роботи' }));
    await waitFor(() => expect(screen.getAllByTestId('catalog-row')).toHaveLength(1));
    expect(screen.getByText('Розетка')).toBeTruthy();
  });
});

describe('AddItemSheet — manual add → save-to-catalog prompt', () => {
  it('adds the line, then offers to save it to the catalog (category/price prefilled)', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue([]);
    vi.mocked(estimatesApi.addItem).mockResolvedValue({
      id: 'li1', type: 'WORK', name: 'Демонтаж розетки', category: 'Демонтаж', unit: 'PIECE',
      quantity: 2, unitPrice: 90, lineTotal: 180, sortOrder: 5,
    } as never);
    vi.mocked(catalogApi.create).mockResolvedValue({
      id: 'c9', name: 'Демонтаж розетки', category: 'Демонтаж', trade: 'OTHER', type: 'WORK',
      unit: 'PIECE', defaultPrice: 90, sortOrder: 0, createdAt: '',
    } as never);
    const onClose = vi.fn();

    renderSheet(onClose);

    fireEvent.click(screen.getByRole('button', { name: 'Вручну' }));
    fireEvent.change(document.querySelector('#it-name')!, { target: { value: 'Демонтаж розетки' } });
    fireEvent.change(document.querySelector('#it-category')!, { target: { value: 'Демонтаж' } });
    fireEvent.change(document.querySelector('#it-qty')!, { target: { value: '2' } });
    fireEvent.change(document.querySelector('#it-price')!, { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Додати' }));

    // Line added; the modal stays open showing the save-to-catalog prompt.
    await waitFor(() => expect(estimatesApi.addItem).toHaveBeenCalled());
    expect(await screen.findByText(/у ваш каталог/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    // Confirm → catalog entry with name/type/unit + the prefilled category/price.
    fireEvent.click(screen.getByRole('button', { name: 'Додати в каталог' }));
    await waitFor(() =>
      // Second arg = the client-generated UUID that makes the create idempotent on replay.
      expect(catalogApi.create).toHaveBeenCalledWith({
        name: 'Демонтаж розетки', category: 'Демонтаж', trade: 'OTHER',
        type: 'WORK', unit: 'PIECE', defaultPrice: 90,
      }, expect.any(String)),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('AddItemSheet — «%» line with a base (regression: submit was silently blocked)', () => {
  // The base line the percentage points at.
  const base: EstimateItemResponse = {
    id: 's1', type: 'WORK', name: 'Шафа', category: null, unit: 'PIECE',
    quantity: 1, unitPrice: 12500, lineTotal: 12500, sortOrder: 0,
    percentBaseKind: null, percentBaseItemId: null, baseDetached: false,
  } as EstimateItemResponse;

  async function openPercentManual() {
    fireEvent.click(screen.getByRole('button', { name: 'Вручну' }));
    fireEvent.change(document.querySelector('#it-name')!, { target: { value: 'Укрупнення' } });
    fireEvent.change(document.querySelector('#it-qty')!, { target: { value: '15' } });
    fireEvent.change(document.querySelector('#it-unit')!, { target: { value: 'PERCENT' } });
  }

  /** The base <select> has no id — reach it through the sibling option it renders. */
  function baseSelect(): HTMLSelectElement {
    return screen.getByRole('option', { name: 'Шафа' }).closest('select') as HTMLSelectElement;
  }

  it('adds a «% від позиції» line once a base is picked (the exact reported case)', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue([]);
    vi.mocked(estimatesApi.addItem).mockResolvedValue({
      id: 'li9', type: 'WORK', name: 'Укрупнення', unit: 'PERCENT',
      quantity: 15, unitPrice: 0, lineTotal: 1875, sortOrder: 5,
      percentBaseKind: 'POSITION', percentBaseItemId: 's1',
    } as never);
    const onClose = vi.fn();
    renderSheet(onClose, [base]);

    await openPercentManual();
    // «Від позиції» base, then pick the sibling in the base <select> (the 3rd combobox).
    fireEvent.click(screen.getByRole('button', { name: 'Від позиції' }));
    fireEvent.change(baseSelect(), { target: { value: 's1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Додати' }));

    // The line is created with the base recorded — NOT swallowed by the hidden price field.
    await waitFor(() =>
      expect(estimatesApi.addItem).toHaveBeenCalledWith(
        'e1',
        expect.objectContaining({
          unit: 'PERCENT', quantity: 15, percentBaseKind: 'POSITION', percentBaseItemId: 's1',
        }),
        expect.any(String),
      ),
    );
  });

  it('blocks a «% від позиції» line with no base picked, and shows why (no silent no-op)', async () => {
    vi.mocked(catalogApi.list).mockResolvedValue([]);
    const onClose = vi.fn();
    renderSheet(onClose, [base]);

    await openPercentManual();
    fireEvent.click(screen.getByRole('button', { name: 'Від позиції' }));
    fireEvent.click(screen.getByRole('button', { name: 'Додати' }));

    // Nothing is sent, and the master is told what's missing — the opposite of "nothing happens".
    expect(await screen.findByText('Спершу оберіть позицію для відсотка')).toBeTruthy();
    expect(estimatesApi.addItem).not.toHaveBeenCalled();
  });

  it('«Від кошторису» + «−» submits a NEGATIVE percent — the sign is the toggle, not a typed minus', async () => {
    // Mobile decimal keypads have no minus key, so a «Від кошторису» discount is a +/− toggle and the
    // field stays a positive magnitude; the sign is applied on submit. «Від позиції» has no toggle.
    const work = {
      id: 'w1', type: 'WORK', name: 'Робота', category: null, unit: 'M2',
      quantity: 1, unitPrice: 1000, lineTotal: 1000, sortOrder: 0,
      percentBaseKind: null, percentBaseItemId: null, baseDetached: false,
    } as EstimateItemResponse;
    vi.mocked(catalogApi.list).mockResolvedValue([]);
    vi.mocked(estimatesApi.addItem).mockResolvedValue({
      id: 'liD', type: 'WORK', name: 'Знижка', unit: 'PERCENT',
      quantity: -15, unitPrice: 0, lineTotal: -150, sortOrder: 5,
      percentBaseKind: 'TOTAL', percentBaseItemId: null,
    } as never);
    renderSheet(vi.fn(), [work]);

    fireEvent.click(screen.getByRole('button', { name: 'Вручну' }));
    fireEvent.change(document.querySelector('#it-name')!, { target: { value: 'Знижка' } });
    fireEvent.change(document.querySelector('#it-unit')!, { target: { value: 'PERCENT' } });
    fireEvent.change(document.querySelector('#it-qty')!, { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Від кошторису' }));
    // The +/− sign toggle appears only for «Від кошторису»; pick «−» (U+2212).
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    fireEvent.click(screen.getByRole('button', { name: 'Додати' }));

    await waitFor(() =>
      expect(estimatesApi.addItem).toHaveBeenCalledWith(
        'e1',
        expect.objectContaining({
          unit: 'PERCENT', quantity: -15, percentBaseKind: 'TOTAL',
        }),
        expect.any(String),
      ),
    );
  });

  it('«Від кошторису» preview base is the SAME-TYPE subtotal, excluding existing % lines (matches the server)', async () => {
    // The bug: the preview used est.total (which folds in existing «% від кошторису» lines) while the
    // server measures against Σ non-percent-of-total lines OF THAT TYPE. With a 3 000 ₴ total-% work
    // line present, a WORK 10 % base must be 10 000 (the work), so 10 % = 1 000 — not 13 000 → 1 300.
    const work = {
      id: 'w1', type: 'WORK', name: 'Робота', category: null, unit: 'M2',
      quantity: 1, unitPrice: 10000, lineTotal: 10000, sortOrder: 0,
      percentBaseKind: null, percentBaseItemId: null, baseDetached: false,
    } as EstimateItemResponse;
    const existingTotalPct = {
      id: 'p1', type: 'WORK', name: 'Транспортні', category: null, unit: 'PERCENT',
      quantity: 30, unitPrice: 0, lineTotal: 3000, sortOrder: 1,
      percentBaseKind: 'TOTAL', percentBaseItemId: null, baseDetached: false,
    } as EstimateItemResponse;
    vi.mocked(catalogApi.list).mockResolvedValue([]);
    renderSheet(vi.fn(), [work, existingTotalPct]);

    fireEvent.click(screen.getByRole('button', { name: 'Вручну' }));
    fireEvent.change(document.querySelector('#it-name')!, { target: { value: 'Надбавка' } });
    fireEvent.change(document.querySelector('#it-unit')!, { target: { value: 'PERCENT' } });
    fireEvent.change(document.querySelector('#it-qty')!, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Від кошторису' }));

    const preview = await screen.findByText(/від робіт.*=/);
    const text = (preview.textContent ?? '').replace(/\s/g, '');
    expect(text).toContain('10000'); // base = the work only
    expect(text).toContain('=1000'); // 10 % of 10 000
    expect(text).not.toContain('13000'); // NOT est.total (10 000 + 3 000)
    expect(text).not.toContain('=1300');
  });

  it('«Від кошторису» is scoped by the line TYPE — a MATERIAL % ignores the works subtotal', async () => {
    // Type scoping is the core new rule: a MATERIAL «Від кошторису» measures the materials subtotal
    // only. With a 10 000 work and a 2 000 material present, a MATERIAL 10 % is 200 (of 2 000), never
    // 1 200 (of 12 000) — the split the master reads on the summary card.
    const work = {
      id: 'w1', type: 'WORK', name: 'Робота', category: null, unit: 'M2',
      quantity: 1, unitPrice: 10000, lineTotal: 10000, sortOrder: 0,
      percentBaseKind: null, percentBaseItemId: null, baseDetached: false,
    } as EstimateItemResponse;
    const material = {
      id: 'm1', type: 'MATERIAL', name: 'Плитка', category: null, unit: 'M2',
      quantity: 1, unitPrice: 2000, lineTotal: 2000, sortOrder: 1,
      percentBaseKind: null, percentBaseItemId: null, baseDetached: false,
    } as EstimateItemResponse;
    vi.mocked(catalogApi.list).mockResolvedValue([]);
    renderSheet(vi.fn(), [work, material]);

    fireEvent.click(screen.getByRole('button', { name: 'Вручну' }));
    fireEvent.change(document.querySelector('#it-name')!, { target: { value: 'Надбавка' } });
    fireEvent.change(document.querySelector('#it-type')!, { target: { value: 'MATERIAL' } });
    fireEvent.change(document.querySelector('#it-unit')!, { target: { value: 'PERCENT' } });
    fireEvent.change(document.querySelector('#it-qty')!, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Від кошторису' }));

    const preview = await screen.findByText(/від матеріалів.*=/);
    const text = (preview.textContent ?? '').replace(/\s/g, '');
    expect(text).toContain('2000'); // base = the material only
    expect(text).toContain('=200'); // 10 % of 2 000
    expect(text).not.toContain('12000'); // NOT works + materials
  });

  it('blocks a SECOND «Від кошторису» of the same type — one markup/discount per works/materials', async () => {
    // A markup AND a discount on the same works is not a real-world case and compounds confusingly,
    // so a second «Від кошторису» of a type is refused with a warning (remove the first or cancel).
    const work = {
      id: 'w1', type: 'WORK', name: 'Робота', category: null, unit: 'M2',
      quantity: 1, unitPrice: 10000, lineTotal: 10000, sortOrder: 0,
      percentBaseKind: null, percentBaseItemId: null, baseDetached: false,
    } as EstimateItemResponse;
    const existingWorkTotal = {
      id: 'p1', type: 'WORK', name: 'Націнка', category: null, unit: 'PERCENT',
      quantity: 12, unitPrice: 0, lineTotal: 1200, sortOrder: 1,
      percentBaseKind: 'TOTAL', percentBaseItemId: null, baseDetached: false,
    } as EstimateItemResponse;
    vi.mocked(catalogApi.list).mockResolvedValue([]);
    renderSheet(vi.fn(), [work, existingWorkTotal]);

    fireEvent.click(screen.getByRole('button', { name: 'Вручну' }));
    fireEvent.change(document.querySelector('#it-name')!, { target: { value: 'Ще одна' } });
    fireEvent.change(document.querySelector('#it-unit')!, { target: { value: 'PERCENT' } });
    fireEvent.change(document.querySelector('#it-qty')!, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Від кошторису' }));

    // The warning appears and nothing is sent (the button is disabled + a submit is guarded).
    expect(await screen.findByText(/вже є націнка\/знижка/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Додати' }));
    expect(estimatesApi.addItem).not.toHaveBeenCalled();
  });
});
