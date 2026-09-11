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
    coverage: { total: 1, covered: 1, gaps: [] },
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

  it('names the positions it could not calculate instead of only counting them', async () => {
    calculate.mockResolvedValue(
      answer({
        coverage: {
          total: 2,
          covered: 1,
          gaps: [
            {
              estimateItemId: 'e2',
              name: 'Монтаж люків ревізійних',
              unit: 'PIECE',
              quantity: 3,
              kind: 'NO_NORM',
            },
          ],
        },
      }),
    );
    renderPage();

    expect(await screen.findByText(/Порахували 1 з 2/)).toBeTruthy();
    fireEvent.click(screen.getByText('Показати, що не порахували'));
    expect(screen.getByText(/Монтаж люків ревізійних/)).toBeTruthy();
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
      expect(calculate).toHaveBeenCalledWith('est-1', { wastePercent: 10, perimeter: 16 }),
    );
  });

  it('re-asks the server for a new allowance instead of scaling the answer on screen', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '15 %' }));

    // Rounding runs UP to a whole package, so 10 % and 15 % of one base are not a factor apart.
    await waitFor(() =>
      expect(calculate).toHaveBeenCalledWith('est-1', { wastePercent: 15, perimeter: undefined }),
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
