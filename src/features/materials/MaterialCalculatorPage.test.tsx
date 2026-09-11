import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { MaterialCalculatorPage } from './MaterialCalculatorPage.tsx';
import type { CalculatedMaterialLine, MaterialCalculationResponse } from '@/api/types.ts';

const calculate = vi.hoisted(() => vi.fn());
const toShoppingList = vi.hoisted(() => vi.fn());
const saveNorm = vi.hoisted(() => vi.fn());
const restoreNorm = vi.hoisted(() => vi.fn());
vi.mock('@/api/materials.ts', () => ({
  materialsApi: { calculate, toShoppingList, saveNorm, restoreNorm },
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
  calculate.mockResolvedValue(answer());
  saveNorm.mockResolvedValue({ id: 'n2', materialId: 'm1', qtyPerUnit: 1.2, ownNorm: true });
  restoreNorm.mockResolvedValue(undefined);
  toShoppingList.mockResolvedValue({ projectId: 'p1' });
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

    expect(await screen.findByText('Потрібен переріз')).toBeTruthy();
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
      }),
    );
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

    expect(await screen.findByText('Потрібен переріз')).toBeTruthy();
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
          section: 0.4,
          amount: 10.56,
        },
      ],
    });
    calculate.mockResolvedValue(answer({ materials: [boxed] }));
    renderPage();
    fireEvent.click(await screen.findByText('Показати розрахунок'));

    // «12 м.п. × переріз 0,4 м × 2,2 = 10,56» — a mistyped розгортка is visible, not hidden.
    expect(screen.getByText(/переріз 0,4 м.*×.*2,2.*=.*10,56/)).toBeTruthy();
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
});
