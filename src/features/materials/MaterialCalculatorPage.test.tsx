import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { MaterialCalculatorPage } from './MaterialCalculatorPage.tsx';
import type { CalculatedMaterialLine, MaterialCalculationResponse } from '@/api/types.ts';

const calculate = vi.hoisted(() => vi.fn());
const toShoppingList = vi.hoisted(() => vi.fn());
const saveNorm = vi.hoisted(() => vi.fn());
const restoreNorm = vi.hoisted(() => vi.fn());
const prefs = vi.hoisted(() => vi.fn());
const savePrefs = vi.hoisted(() => vi.fn());
vi.mock('@/api/materials.ts', () => ({
  materialsApi: { calculate, toShoppingList, saveNorm, restoreNorm, prefs, savePrefs },
}));

function line(over: Partial<CalculatedMaterialLine> = {}): CalculatedMaterialLine {
  return {
    materialId: 'm1',
    name: 'Лист ГКЛ 1200×2500',
    unit: 'M2',
    baseQuantity: 20,
    quantity: 21,
    wastePercent: 10,
    packageSize: 3,
    packageName: 'лист',
    packages: 7,
    sources: [
      {
        estimateItemId: 'e1',
        name: 'Монтаж гіпсокартону на стіни',
        unit: 'M2',
        quantity: 20,
        qtyPerUnit: 1,
        normId: 'n1',
        ownNorm: false,
        basis: 'QUANTITY',
        amount: 20,
      },
    ],
    ...over,
  };
}

function answer(over: Partial<MaterialCalculationResponse> = {}): MaterialCalculationResponse {
  return {
    materials: [line()],
    coverage: { trades: ['DRYWALL'], otherWorks: false },
    parameters: [],
    wastePercent: 10,
    perimeter: null,
    estimateSigned: true,
    ...over,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/estimates/:id/materials', element: <MaterialCalculatorPage /> },
      { path: '*', element: <div>інший екран</div> },
    ],
    { initialEntries: ['/estimates/est-1/materials'] },
  );
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calculate.mockReset();
  toShoppingList.mockReset();
  saveNorm.mockReset();
  restoreNorm.mockReset();
  prefs.mockReset();
  savePrefs.mockReset();
  calculate.mockResolvedValue(answer());
  saveNorm.mockResolvedValue({ id: 'n2', materialId: 'm1', qtyPerUnit: 1.2, ownNorm: true });
  restoreNorm.mockResolvedValue(undefined);
  toShoppingList.mockResolvedValue({ projectId: 'p1' });
  prefs.mockResolvedValue({ prefs: {} });
  savePrefs.mockResolvedValue({ prefs: {} });
});

describe('MaterialCalculatorPage', () => {
  it('says out loud that the numbers are approximate', async () => {
    renderPage();

    // The heading is the disclaimer's first half — a master reading only the title still learns it.
    expect(await screen.findByText(/орієнтовно/)).toBeTruthy();
    expect(screen.getByText(/не істина/)).toBeTruthy();
  });

  it('shows each row its own arithmetic', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Показати розрахунок'));

    // «20 м² × 1 = 20» — the master can check it, which is the whole point of the screen.
    expect(screen.getByText(/Монтаж гіпсокартону на стіни.*20.*×.*1.*=.*20/)).toBeTruthy();
    expect(screen.getByText(/запас 10 %/)).toBeTruthy();
  });

  it('names the trades it calculated for, and lists no gaps', async () => {
    calculate.mockResolvedValue(
      answer({ coverage: { trades: ['DRYWALL', 'PAINTER'], otherWorks: false } }),
    );
    renderPage();

    // The master's own wording (2026-09-11). «Порахували 8 з 39» over 31 named demolition lines is
    // the shape he rejected: «то думаю треба забрати».
    expect(
      await screen.findByText('Порахували матеріали для: Гіпсокартон, Малярні роботи'),
    ).toBeTruthy();
    expect(screen.queryByText(/не порахували/)).toBeFalsy();
  });

  /** `estimate_items.trade` is nullable (V125), so a counted position may name no trade at all. */
  it('says «інші роботи» for a counted position that carries no trade', async () => {
    calculate.mockResolvedValue(answer({ coverage: { trades: ['DRYWALL'], otherWorks: true } }));
    renderPage();

    expect(await screen.findByText('Порахували матеріали для: Гіпсокартон, інші роботи')).toBeTruthy();
  });

  it('says so in one line when nothing could be calculated', async () => {
    calculate.mockResolvedValue(
      answer({ materials: [], coverage: { trades: [], otherWorks: false } }),
    );
    renderPage();

    expect(await screen.findByText(/Норм для цього кошторису ще немає/)).toBeTruthy();
  });

  /**
   * An estimate applied from a bundle carries every quantity at zero, and «ми не знаємо норм для
   * цих робіт» would be a plainly false thing to tell him about work we DO norm — he would go
   * looking for a bug that is not there. The empty screen has two sentences behind it.
   */
  it('asks for quantities instead of claiming it knows no norms', async () => {
    calculate.mockResolvedValue(
      answer({ materials: [], coverage: { trades: [], otherWorks: false }, quantitiesMissing: true }),
    );
    renderPage();

    expect(await screen.findByText('Впишіть кількості')).toBeTruthy();
    expect(screen.queryByText('Нема що рахувати')).toBeFalsy();
    // ...and the coverage line is gone with it. Caught on production: it answers «what did the
    // calculation cover», so with nothing calculated its empty form («норм ще немає») stood
    // directly above an empty state saying we DO know the norms.
    expect(screen.queryByText(/Норм для цього кошторису ще немає/)).toBeFalsy();
  });

  it('asks for the perimeter rather than guessing it from the area', async () => {
    calculate.mockResolvedValue(
      answer({ parameters: [{ parameter: 'PERIMETER', materialName: 'Профіль UD 27×28' }] }),
    );
    renderPage();

    expect(await screen.findByText('Потрібен периметр')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Периметр, м.п.'), { target: { value: '16' } });
    fireEvent.click(screen.getByText('Порахувати'));

    await waitFor(() =>
      expect(calculate).toHaveBeenCalledWith('est-1', {
        wastePercent: 10,
        perimeter: 16,
        sections: undefined,
        thicknesses: undefined,
      }),
    );
  });

  it('asks each box for its own section, never one figure for both', async () => {
    calculate.mockResolvedValue(
      answer({
        materials: [],
        parameters: [
          {
            parameter: 'SECTION',
            materialName: 'Лист ГКЛ',
            estimateItemId: 'e1',
            positionName: 'Монтаж короба (прямого)',
          },
          {
            parameter: 'SECTION',
            materialName: 'Профіль CD 60×27',
            estimateItemId: 'e1',
            positionName: 'Монтаж короба (прямого)',
          },
          {
            parameter: 'SECTION',
            materialName: 'Лист ГКЛ',
            estimateItemId: 'e2',
            positionName: 'Монтаж ніші',
          },
        ],
      }),
    );
    renderPage();

    expect(await screen.findByText('Потрібна розгортка')).toBeTruthy();
    // One input per POSITION: the board and the ribs of one короб share a single розгортка.
    fireEvent.change(screen.getByLabelText('Монтаж короба (прямого)'), {
      target: { value: '0,4' },
    });
    fireEvent.change(screen.getByLabelText('Монтаж ніші'), { target: { value: '1,2' } });
    fireEvent.click(screen.getByText('Порахувати'));

    await waitFor(() =>
      expect(calculate).toHaveBeenCalledWith('est-1', {
        wastePercent: 10,
        perimeter: undefined,
        sections: 'e1:0.4,e2:1.2',
        thicknesses: undefined,
      }),
    );
  });

  it('refuses a perimeter that is not a number instead of sending it', async () => {
    calculate.mockResolvedValue(
      answer({ parameters: [{ parameter: 'PERIMETER', materialName: 'Профіль UD 27×28' }] }),
    );
    renderPage();

    expect(await screen.findByText('Потрібен периметр')).toBeTruthy();
    calculate.mockClear();
    fireEvent.change(screen.getByLabelText('Периметр, м.п.'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByText('Порахувати'));

    // «abc» parsed to NaN and was applied and sent; the server's 400 came back as «Не вдалося
    // порахувати», so the screen blamed the connection for a typo and offered nothing to fix.
    expect(screen.getByText('Впишіть число більше 0 і не більше 1000')).toBeTruthy();
    expect(calculate).not.toHaveBeenCalled();
  });

  it('keeps the fields on screen when the server refuses the figure', async () => {
    calculate.mockResolvedValue(
      answer({ parameters: [{ parameter: 'PERIMETER', materialName: 'Профіль UD 27×28' }] }),
    );
    renderPage();
    expect(await screen.findByText('Потрібен периметр')).toBeTruthy();

    calculate.mockRejectedValue(new Error('400'));
    fireEvent.change(screen.getByLabelText('Периметр, м.п.'), { target: { value: '16' } });
    fireEvent.click(screen.getByText('Порахувати'));

    // The parameters ride the query KEY, so a refused figure is an ERROR query holding no data —
    // and the old layout replaced the WHOLE body, taking away the field he had to correct.
    expect(await screen.findByText('Не вдалося порахувати')).toBeTruthy();
    expect(screen.getByLabelText('Периметр, м.п.')).toBeTruthy();
    expect(screen.getByText('Запас')).toBeTruthy();
  });

  it('does not ask for a perimeter when the only missing figure is a section', async () => {
    calculate.mockResolvedValue(
      answer({
        parameters: [
          {
            parameter: 'SECTION',
            materialName: 'Лист ГКЛ',
            estimateItemId: 'e1',
            positionName: 'Монтаж короба (прямого)',
          },
        ],
      }),
    );
    renderPage();

    expect(await screen.findByText('Потрібна розгортка')).toBeTruthy();
    expect(screen.queryByText('Потрібен периметр')).toBeFalsy();
  });

  it('shows the section as its own factor in the arithmetic', async () => {
    const boxed = line({
      unit: 'M2',
      sources: [
        {
          estimateItemId: 'e1',
          name: 'Монтаж короба (прямого)',
          unit: 'LINEAR_METER',
          quantity: 12,
          qtyPerUnit: 2.2,
          normId: 'n1',
          ownNorm: false,
          basis: 'SECTION',
          param: 0.4,
          amount: 10.56,
        },
      ],
    });
    calculate.mockResolvedValue(answer({ materials: [boxed] }));
    renderPage();
    fireEvent.click(await screen.findByText('Показати розрахунок'));

    // «12 м.п. × розгортка 0,4 м × 2,2 = 10,56» — a mistyped розгортка is visible, not hidden.
    expect(screen.getByText(/розгортка 0,4 м.*×.*2,2.*=.*10,56/)).toBeTruthy();
  });

  it('re-asks the server for a new allowance instead of scaling the answer on screen', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '15 %' }));

    // Rounding runs UP to a whole package, so 10 % and 15 % of one base are not a factor apart.
    await waitFor(() =>
      expect(calculate).toHaveBeenCalledWith('est-1', {
        wastePercent: 15,
        perimeter: undefined,
        sections: undefined,
        thicknesses: undefined,
      }),
    );
  });

  it('sends the numbers the master left on the screen, not the ones it proposed', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText(/Кількість: Лист ГКЛ/), {
      target: { value: '24' },
    });
    fireEvent.click(screen.getByText(/У список покупок/));

    await waitFor(() =>
      expect(toShoppingList).toHaveBeenCalledWith('est-1', {
        materials: [{ materialId: 'm1', quantity: 24 }],
      }),
    );
  });

  it('drops a row the master zeroed out', async () => {
    calculate.mockResolvedValue(answer({ materials: [line(), line({ materialId: 'm2', name: 'Мінеральна вата' })] }));
    renderPage();
    fireEvent.change(await screen.findByLabelText(/Кількість: Мінеральна вата/), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByText(/У список покупок/));

    await waitFor(() =>
      expect(toShoppingList).toHaveBeenCalledWith('est-1', {
        materials: [{ materialId: 'm1', quantity: 21 }],
      }),
    );
  });

  it('saves a corrected coefficient and re-asks the server instead of scaling on screen', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Показати розрахунок'));
    fireEvent.click(screen.getByText('Змінити норму'));
    fireEvent.change(screen.getByLabelText(/Норма на 1/), { target: { value: '1,2' } });
    fireEvent.click(screen.getByText('Зберегти як мою норму'));

    await waitFor(() => expect(saveNorm).toHaveBeenCalledWith('n1', { qtyPerUnit: 1.2 }));
    // Rounding up to a whole package does not commute with scaling, so the answer is recomputed.
    await waitFor(() => expect(calculate).toHaveBeenCalledTimes(2));
  });

  it('refuses a coefficient of zero without asking the server', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Показати розрахунок'));
    fireEvent.click(screen.getByText('Змінити норму'));
    fireEvent.change(screen.getByLabelText(/Норма на 1/), { target: { value: '0' } });
    fireEvent.click(screen.getByText('Зберегти як мою норму'));

    expect(saveNorm).not.toHaveBeenCalled();
  });

  it('does not offer the standard rate back where the coefficient is the shipped one', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Показати розрахунок'));
    fireEvent.click(screen.getByText('Змінити норму'));

    expect(screen.queryByText('Стандартна')).toBeFalsy();
  });

  it('restores the shipped norm from a row the master had already corrected', async () => {
    const own = line();
    own.sources[0].ownNorm = true;
    calculate.mockResolvedValue(answer({ materials: [own] }));
    renderPage();
    fireEvent.click(await screen.findByText('Показати розрахунок'));
    expect(screen.getByText('моя норма')).toBeTruthy();
    fireEvent.click(screen.getByText('Змінити норму'));
    fireEvent.click(screen.getByText('Стандартна'));

    await waitFor(() => expect(restoreNorm).toHaveBeenCalledWith('n1'));
  });

  it('says the figures can still move while the estimate is unsigned, and blocks nothing', async () => {
    calculate.mockResolvedValue(answer({ estimateSigned: false }));
    renderPage();

    expect(await screen.findByText(/кількості можуть змінитись/)).toBeTruthy();
    // A hint, not a gate: the buying destination stays live.
    expect(screen.getByText(/У список покупок/).closest('button')?.disabled).toBeFalsy();
  });

  it('offers the shopping list as the only destination — never the estimate', async () => {
    renderPage();

    expect(await screen.findByText(/У список покупок/)).toBeTruthy();
    // «Прибираємо» (V129): the server endpoint is gone, so a button here would be a live 404 —
    // and a 0 ₴ material line inside a signed document is worse than no line at all.
    expect(screen.queryByText(/Додати в кошторис/)).toBeFalsy();
  });

  /**
   * The silent half of the same bug P-05 fixed for the perimeter: `parseDecimal('abc')` is NaN, the
   * payload filter dropped the row, and the rest went off to the shopping list. The master found out
   * at the merchant, by the material not being on it.
   */
  it('holds a mistyped quantity on screen instead of dropping the material from the list', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText(/Кількість: Лист ГКЛ/), {
      target: { value: 'abc' },
    });

    expect(screen.getByText('Впишіть кількість більше нуля або залиште порожнім')).toBeTruthy();
    const send = screen.getByText(/У список покупок/).closest('button');
    expect(send?.disabled).toBe(true);
    if (send) fireEvent.click(send);
    expect(toShoppingList).not.toHaveBeenCalled();
  });

  it('still takes 0 as «не це» rather than as a typo', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText(/Кількість: Лист ГКЛ/), { target: { value: '0' } });

    expect(screen.queryByText(/Впишіть кількість/)).toBeFalsy();
  });

  it('re-counts the packages from the master’s own number, not the one we proposed', async () => {
    renderPage();
    // 21 м² at 3 м² a sheet is the 7 the server sent.
    expect(await screen.findByText(/7 × лист/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Кількість: Лист ГКЛ/), { target: { value: '24' } });

    // «7 × лист» under a quantity he had corrected to 24 was our arithmetic contradicting his, on
    // the same line — and the packages are what he actually carries to the till.
    expect(screen.getByText(/8 × лист/)).toBeTruthy();
    expect(screen.queryByText(/7 × лист/)).toBeFalsy();
  });

  it('keeps the last answer on screen while a new allowance is being calculated', async () => {
    renderPage();
    expect(await screen.findByText('Лист ГКЛ 1200×2500')).toBeTruthy();

    const pending: { resolve: (value: MaterialCalculationResponse) => void } = {
      resolve: () => undefined,
    };
    calculate.mockReturnValueOnce(
      new Promise<MaterialCalculationResponse>((res) => {
        pending.resolve = res;
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '15 %' }));

    // Every parameter change is a new query key, so the whole screen — controls, figures and all —
    // used to collapse into a full-page spinner on each tap of the waste steps.
    expect(await screen.findByText('Перераховуємо…')).toBeTruthy();
    expect(screen.getByText('Лист ГКЛ 1200×2500')).toBeTruthy();
    expect(screen.getByText('Запас')).toBeTruthy();

    await act(async () => {
      pending.resolve(answer({ wastePercent: 15 }));
    });
  });

  /**
   * V137's whole point: «штукатурка до 2 см» names a LIMIT, and 15 мм against 20 мм is a third of
   * the plaster. The suggestion is pre-filled so the common case is one tap — and named out loud,
   * because a number that appeared by itself in a field reads as one the master typed.
   */
  it('pre-fills the thickness it suggests and says the figure is ours', async () => {
    calculate.mockResolvedValue(
      answer({
        materials: [],
        parameters: [
          {
            parameter: 'THICKNESS',
            materialName: 'Суміш штукатурна',
            estimateItemId: 'e1',
            positionName: 'Штукатурення стін',
            suggested: 15,
          },
        ],
      }),
    );
    renderPage();

    expect(await screen.findByText('Потрібна товщина шару')).toBeTruthy();
    expect(await screen.findByDisplayValue('15')).toBeTruthy();
    expect(screen.getByText(/Підставили типову товщину/)).toBeTruthy();
    fireEvent.click(screen.getByText('Порахувати'));

    await waitFor(() =>
      expect(calculate).toHaveBeenCalledWith('est-1', {
        wastePercent: 10,
        perimeter: undefined,
        sections: undefined,
        thicknesses: 'e1:15',
      }),
    );
  });

  it('never puts its own suggestion back over the thickness the master typed', async () => {
    calculate.mockResolvedValue(
      answer({
        materials: [],
        parameters: [
          {
            parameter: 'THICKNESS',
            materialName: 'Суміш штукатурна',
            estimateItemId: 'e1',
            positionName: 'Штукатурення стін',
            suggested: 15,
          },
        ],
      }),
    );
    renderPage();

    const field = await screen.findByLabelText('Штукатурення стін');
    fireEvent.change(field, { target: { value: '25' } });
    fireEvent.click(screen.getByText('Порахувати'));

    // The answer still carries `suggested: 15`, and it arrives AFTER he typed: refilling the field
    // would silently buy plaster for a wall he told us is thicker.
    await waitFor(() =>
      expect(calculate).toHaveBeenCalledWith('est-1', {
        wastePercent: 10,
        perimeter: undefined,
        sections: undefined,
        thicknesses: 'e1:25',
      }),
    );
    expect(await screen.findByDisplayValue('25')).toBeTruthy();
  });

  it('shows the thickness as its own factor, in millimetres', async () => {
    const plaster = line({
      name: 'Суміш штукатурна',
      unit: 'M2',
      sources: [
        {
          estimateItemId: 'e1',
          name: 'Штукатурення стін',
          unit: 'M2',
          quantity: 30,
          qtyPerUnit: 0.85,
          normId: 'n1',
          ownNorm: false,
          basis: 'THICKNESS',
          param: 15,
          amount: 382.5,
        },
      ],
    });
    calculate.mockResolvedValue(answer({ materials: [plaster] }));
    renderPage();
    fireEvent.click(await screen.findByText('Показати розрахунок'));

    // «30 м² × товщина 15 мм × 0,85 = 382,5» — the coefficient is per m² PER MM, so the millimetres
    // have to be visible or the line reads as arithmetic that is off by an order of magnitude.
    expect(screen.getByText(/товщина 15 мм.*×.*0,85.*=.*382,5/)).toBeTruthy();
  });

  /**
   * The defect V137 found: `PAINT_COVERAGE` and `PAINT_COATS` existed in the schema from V126 and
   * NOTHING read or offered them, so a master painting three coats got two coats' worth of paint on
   * every estimate — silently.
   */
  it('asks the painter about his paint, and remembers it for every object', async () => {
    calculate.mockResolvedValue(answer({ coverage: { trades: ['PAINTER'], otherWorks: false } }));
    prefs.mockResolvedValue({ prefs: { PAINT_COATS: '3' } });
    savePrefs.mockResolvedValue({ prefs: { PAINT_COATS: '3', PAINT_COVERAGE: '8' } });
    renderPage();
    fireEvent.click(await screen.findByText('Мої звички'));

    expect(await screen.findByDisplayValue('3')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Фарба: м² з літра за один шар'), {
      target: { value: '8' },
    });
    fireEvent.click(screen.getByText('Зберегти звички'));

    // Every shown field is sent, blanks included — a blank FORGETS the habit server-side.
    await waitFor(() =>
      expect(savePrefs).toHaveBeenCalledWith({ prefs: { PAINT_COVERAGE: '8', PAINT_COATS: '3' } }),
    );
    // A habit rescales the coefficients, and rounding up to a package does not commute with
    // scaling — so the answer is recomputed, same as the waste toggle and a corrected norm.
    await waitFor(() => expect(calculate).toHaveBeenCalledTimes(2));
  });

  it('never hands a drywaller a question about paint', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Мої звички'));

    expect(await screen.findByLabelText(/Гіпсокартон: формат листа/)).toBeTruthy();
    expect(screen.queryByLabelText(/Фарба/)).toBeFalsy();
    expect(screen.queryByLabelText(/Плитка/)).toBeFalsy();
  });
});
