import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ItemForm } from './ItemForm.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { catalogApi } from '@/api/catalog.ts';
import { aUser } from '@/test/factories.ts';
import { asInput } from '@/test/dom.ts';
import type { EstimateItemResponse } from '@/api/types.ts';

vi.mock('@/api/catalog.ts', () => ({
  catalogApi: { list: vi.fn(), create: vi.fn(), categories: vi.fn(), search: vi.fn() },
}));

const line = (over: Partial<EstimateItemResponse>): EstimateItemResponse => ({
  id: 'a', type: 'WORK', name: 'Підготовка ГКЛ під фарбування · Q4 (еліт)', category: 'Оздоблення',
  unit: 'M2', quantity: 12, unitPrice: 260, lineTotal: 3120, sortOrder: 0,
  measurementRefs: [], quantityManual: false,
  percentBaseKind: null, percentBaseItemId: null, baseDetached: false, baseOriginLabel: null,
  closedByActs: null,
  ...over,
});

function renderForm(initial: EstimateItemResponse, onSubmit = vi.fn(), objectId?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, aUser());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <ItemForm initial={initial} objectId={objectId} submitLabel="Зберегти" submitting={false} onSubmit={onSubmit} />,
    { wrapper },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(catalogApi.categories).mockResolvedValue([]);
  vi.mocked(catalogApi.search).mockResolvedValue([]);
});

/**
 * The editor is the one surface with room for the WHOLE explanation — the catalog row and the
 * estimate board both clamp it to a single line. It is read-only on purpose: the wording is a
 * snapshot of the catalog position the line came from (V119), and the hint says out loud that the
 * client will read it, which is the master's own question («звідки клієнт має знати що це таке?»).
 */
describe('ItemForm — the position explanation', () => {
  const MEANS = 'Найвищий рівень: суцільне шпаклювання, під глянцеву фарбу та бокове світло.';

  it('shows the full explanation, and says where the client will see it', () => {
    renderForm(line({ description: MEANS }));

    expect(screen.getByText('Що це означає')).toBeTruthy();
    expect(screen.getByText(MEANS)).toBeTruthy();
    expect(screen.getByText(/в порталі та в PDF/)).toBeTruthy();
  });

  it('offers no panel, and no editable field, for a line that carries no explanation', () => {
    renderForm(line({ description: null }));

    expect(screen.queryByText('Що це означає')).toBeNull();
  });

  it('never turns the explanation into an input — it belongs to the catalog position', () => {
    renderForm(line({ description: MEANS }));

    // A textbox here would let a rename-style edit rewrite what a client already read; the field
    // is not on EstimateItemRequest at all, so anything typed would be silently dropped.
    expect(screen.queryByDisplayValue(MEANS)).toBeNull();
  });
});

/**
 * Review P-58: validation read the price with `parseMoney` (which takes the apostrophe as grouping)
 * while the submit read it with `parseDecimal` — «1'200» passed validation and was sent as NaN,
 * which went offline into the queue, printed «NaN ₴» and blocked the replay.
 */
describe('ItemForm — what is submitted is what was validated', () => {
  it("sends «1'200» as 1200, never NaN", async () => {
    const onSubmit = vi.fn();
    renderForm(line({ description: null }), onSubmit);

    fireEvent.change(screen.getByLabelText(/Ціна/), { target: { value: "1'200" } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ unitPrice: 1200, quantity: 12 });
  });
});

/** The line's amount while he types, by the rounding the server stores it with. */
describe('ItemForm — the live line sum', () => {
  const sum = () => screen.getByTestId('line-sum').textContent ?? '';

  it('shows quantity × price and follows the typing', () => {
    renderForm(line({}));
    expect(sum()).toMatch(/^Сума: 3\s120\s₴$/);

    fireEvent.change(screen.getByLabelText(/Кількість/), { target: { value: '2,5' } });
    expect(sum()).toMatch(/^Сума: 650\s₴$/);
  });

  it('rounds half up to the kopeck', () => {
    renderForm(line({ quantity: 0.125, unitPrice: 1 }));
    expect(sum()).toMatch(/^Сума: 0,13\s₴$/);
  });

  it('shows nothing — not «0 ₴» — while a field is empty or not a number', () => {
    renderForm(line({}));
    fireEvent.change(screen.getByLabelText(/Кількість/), { target: { value: '' } });
    expect(sum()).toBe('');

    fireEvent.change(screen.getByLabelText(/Кількість/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Ціна/), { target: { value: 'abc' } });
    expect(sum()).toBe('');
  });

  it('leaves a «%» line to its own preview', () => {
    renderForm(line({ unit: 'PERCENT', quantity: 10, unitPrice: 0, percentBaseKind: 'TOTAL' }));
    expect(screen.queryByTestId('line-sum')).toBeNull();
  });
});

/**
 * The line's size calculator (size S): plain-words buttons, a rectangle first with the other shapes
 * one tap away, and «Застосувати» that saves an otherwise untouched line in the same tap.
 */
describe('ItemForm — the size calculator', () => {
  const openCalc = () => fireEvent.click(screen.getByRole('button', { name: /Порахувати за розмірами/ }));
  const typeSides = (a: string, b: string) => {
    fireEvent.change(screen.getByLabelText(/^a /), { target: { value: a } });
    fireEvent.change(screen.getByLabelText(/^b /), { target: { value: b } });
  };

  it('says what each door does, and what happens to the openings', () => {
    renderForm(line({ unit: 'M2' }), vi.fn(), 'obj-1');
    expect(screen.getByRole('button', { name: '📐 Порахувати за розмірами' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /📋 Взяти із замірів об'єкта/ })).toBeTruthy();

    openCalc();

    const heading = screen.getByText(/^Прорізи \(вікна, двері\) — віднімемо від площі$/);
    expect(heading.textContent).not.toMatch(/\(м\)/);
  });

  it('shows the rectangle and folds the other shapes behind «Інша форма ▾»', () => {
    renderForm(line({ unit: 'M2' }));
    openCalc();

    expect(screen.getByRole('button', { name: 'Прямокутник' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Трапеція' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Інша форма ▾' }));
    fireEvent.click(screen.getByRole('button', { name: 'Трапеція' }));

    // The chosen shape stays in view; the fold button is gone once opened.
    expect(screen.getByRole('button', { name: 'Трапеція' }).className).toContain('bg-primary');
    expect(screen.queryByRole('button', { name: 'Інша форма ▾' })).toBeNull();
  });

  it('every field of the calculator opens the decimal keypad (it has the comma)', () => {
    renderForm(line({ unit: 'M2' }));
    openCalc();
    fireEvent.click(screen.getByRole('button', { name: /Проріз/ }));

    const calc = screen.getByTestId('calc-footer').parentElement!;
    const fields = calc.querySelectorAll('input');
    expect(fields.length).toBeGreaterThanOrEqual(5); // a, b, width, height, count
    fields.forEach((f) => expect(f.getAttribute('inputmode')).toBe('decimal'));
  });

  it('«Застосувати» saves a line whose only change is the measured quantity', async () => {
    const onSubmit = vi.fn();
    renderForm(line({ unit: 'M2' }), onSubmit);
    openCalc();
    typeSides('4,5', '2,8');

    fireEvent.click(screen.getByRole('button', { name: 'Застосувати' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ quantity: 12.6, unitPrice: 260 });
  });

  it('«Застосувати» only fills the quantity when something else is still unsaved', async () => {
    const onSubmit = vi.fn();
    renderForm(line({ unit: 'M2' }), onSubmit);
    fireEvent.change(screen.getByLabelText(/Ціна/), { target: { value: '300' } });
    openCalc();
    typeSides('4,5', '2,8');

    fireEvent.click(screen.getByRole('button', { name: 'Застосувати' }));

    await waitFor(() => expect(asInput(screen.getByLabelText(/Кількість/)).value).toBe('12.6'));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
