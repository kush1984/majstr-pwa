import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { TransferPage, toCommitRequest, defaultObjectName, dominantTrade, type TransferCard } from './TransferPage.tsx';
import { transferApi } from '@/api/transfer.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { aUser } from '@/test/factories.ts';
import type { TransferParseResponse } from '@/api/types.ts';

vi.mock('@/api/transfer.ts', () => ({ transferApi: { parseFile: vi.fn(), commit: vi.fn() } }));
vi.mock('@/api/projects.ts', () => ({ projectsApi: { list: vi.fn(() => Promise.resolve([])) } }));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const estimate: TransferParseResponse = {
  fileName: 'franka.pdf', kind: 'ESTIMATE', objectName: 'Квартира, Франка 12', address: 'вул. Франка 12',
  clientName: 'Олена', title: 'Кухня', depositAmount: 5000,
  items: [
    { name: 'Укладання плитки', unit: 'M2', quantity: 12, unitPrice: 600, type: 'WORK', section: 'Кухня',
      trade: 'TILING', category: 'Підлога', issues: [] },
    { name: 'Щось без одиниці', unit: null, quantity: 1, unitPrice: 100, type: 'WORK', section: null,
      trade: null, category: null, issues: ['unit'] },
  ],
};
const priceList: TransferParseResponse = {
  fileName: 'prais.xlsx', kind: 'PRICE_LIST', objectName: null, address: null, clientName: null, title: null,
  depositAmount: null,
  items: [{ name: 'Штукатурка стін', unit: 'M2', quantity: 0, unitPrice: 250, type: 'WORK', section: null,
    trade: null, category: null, issues: [] }],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, aUser());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
  );
  return render(<TransferPage />, { wrapper });
}

function pick(files: File[]) {
  const input = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

beforeEach(() => vi.clearAllMocks());

describe('TransferPage', () => {
  it('reads every file, then moves the estimate onto a new object and the price list into the catalog', async () => {
    vi.mocked(transferApi.parseFile).mockResolvedValueOnce(estimate).mockResolvedValueOnce(priceList);
    vi.mocked(transferApi.commit).mockResolvedValue({
      objectsCreated: 1, estimatesCreated: 1, catalogCreated: 2, catalogUpdated: 0, catalogSkipped: 0, projectIds: ['p1'],
    });
    renderPage();

    pick([new File(['%PDF'], 'franka.pdf', { type: 'application/pdf' }), new File(['x'], 'prais.xlsx')]);

    expect(await screen.findByDisplayValue('Квартира, Франка 12')).toBeTruthy();
    expect(screen.getByText(/1 без одиниці виміру — оберіть її/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Перенести' }));

    await waitFor(() => expect(transferApi.commit).toHaveBeenCalled());
    const req = vi.mocked(transferApi.commit).mock.calls[0][0];
    expect(req.estimates).toHaveLength(1);
    expect(req.estimates[0]).toMatchObject({
      projectId: null, objectName: 'Квартира, Франка 12', clientName: 'Олена', depositAmount: 5000,
    });
    expect(req.estimates[0].items).toHaveLength(1); // the line with no unit stays behind
    expect(req.estimates[0].items[0]).toMatchObject({ trade: 'TILING', section: 'Кухня', category: 'Підлога' });
    expect(req.priceLists[0].items[0]).toMatchObject({ name: 'Штукатурка стін', price: 250 });
    expect(await screen.findByText('Перенесено')).toBeTruthy();
  });

  it('a file read as the wrong kind is switched by the master, and a skipped one sends nothing', async () => {
    vi.mocked(transferApi.parseFile).mockResolvedValueOnce(priceList);
    renderPage();
    pick([new File(['x'], 'prais.xlsx')]);

    fireEvent.click(await screen.findByRole('radio', { name: 'Пропустити' }));

    expect(screen.getByRole('button', { name: 'Перенести' }).hasAttribute('disabled')).toBe(true);
  });

  it('a line with no unit is offered a unit, and comes in once he picks one', async () => {
    vi.mocked(transferApi.parseFile).mockResolvedValueOnce(estimate);
    vi.mocked(transferApi.commit).mockResolvedValue({
      objectsCreated: 1, estimatesCreated: 1, catalogCreated: 2, catalogUpdated: 0, catalogSkipped: 0, projectIds: ['p1'],
    });
    renderPage();
    pick([new File(['%PDF'], 'franka.pdf', { type: 'application/pdf' })]);

    const unit = await screen.findByLabelText<HTMLSelectElement>('Одиниця для «Щось без одиниці»');
    fireEvent.change(unit, { target: { value: 'PIECE' } });
    expect(await screen.findByText('Одиниці задано — ці позиції теж перенесемо')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Перенести' }));

    await waitFor(() => expect(transferApi.commit).toHaveBeenCalled());
    const items = vi.mocked(transferApi.commit).mock.calls[0][0].estimates[0].items;
    expect(items.map((i) => [i.name, i.unit])).toEqual([['Укладання плитки', 'M2'], ['Щось без одиниці', 'PIECE']]);
  });

  it('one unreadable file costs only itself', async () => {
    vi.mocked(transferApi.parseFile).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(priceList);
    renderPage();
    pick([new File(['x'], 'bad.pdf'), new File(['x'], 'prais.xlsx')]);

    expect(await screen.findByText('📎 bad.pdf')).toBeTruthy();
    expect(screen.getByText('1 позицій → у каталог')).toBeTruthy();
  });
});

describe('TransferPage — a table read without AI (one door with «Імпортувати прайс», 2026-11-20)', () => {
  const table: TransferParseResponse = {
    ...priceList,
    table: { columns: ['Колонка 1 · Назва', 'Колонка 2 · Од.', 'Колонка 3 · Ціна'], nameCol: 0, priceCol: 2, unitCol: 1 },
  };

  it('shows the columns it took, and reads the file again with the ones he picks', async () => {
    vi.mocked(transferApi.parseFile).mockResolvedValueOnce(table).mockResolvedValueOnce({
      ...table,
      items: [{ ...priceList.items[0], name: 'м2' }],
      table: { ...table.table!, nameCol: 1 },
    });
    renderPage();
    const file = new File(['x'], 'prais.xlsx');
    pick([file]);

    const name = await screen.findByLabelText<HTMLSelectElement>('Назва');
    expect(name.value).toBe('0');
    fireEvent.change(name, { target: { value: '1' } });

    await waitFor(() => expect(transferApi.parseFile).toHaveBeenCalledTimes(2));
    expect(vi.mocked(transferApi.parseFile).mock.calls[1]).toEqual([file, { nameCol: 1, priceCol: 2, unitCol: 1 }]);
    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('Назва').value).toBe('1'));
  });

  it('offers no column pickers for what the AI read', async () => {
    vi.mocked(transferApi.parseFile).mockResolvedValueOnce(priceList);
    renderPage();
    pick([new File(['x'], 'prais.pdf')]);

    expect(await screen.findByText('1 позицій → у каталог')).toBeTruthy();
    expect(screen.queryByLabelText('Назва')).toBeNull();
  });
});

describe('toCommitRequest', () => {
  const card = (over: Partial<TransferCard>): TransferCard => ({
    key: 1, fileName: 'f.pdf', parsed: estimate, error: null, choice: 'ESTIMATE', projectId: '',
    objectName: 'Обʼєкт', estimateName: '', toCatalog: true, trade: '', ...over,
  });

  it('an existing object carries its id and none of the new-object meta', () => {
    const req = toCommitRequest([card({ projectId: 'p-9' })], false);
    expect(req.estimates[0]).toMatchObject({ projectId: 'p-9', objectName: null, clientName: null, address: null });
    expect(req.defaultPolicy).toBe('SKIP');
  });

  it('a price list goes under the trade he chose, foldered by its own sections', () => {
    // Universal, not one file's fix: the master's own grouping beats ours, and one price list is one trade.
    const list: TransferParseResponse = {
      ...priceList,
      items: [
        { ...priceList.items[0], name: 'Демонтаж плитки', section: 'Підготовка', trade: 'DEMOLITION', category: 'Плитка' },
        { ...priceList.items[0], name: 'Запил кутів', section: 'Облицювання стін', trade: 'METAL', category: 'Різка' },
        { ...priceList.items[0], name: 'Без розділу', section: null, trade: 'TILING', category: 'Підлога' },
        { ...priceList.items[0], name: 'Невідоме', section: null, trade: null, category: null },
      ],
    };
    const req = toCommitRequest([card({ parsed: list, choice: 'PRICE_LIST', trade: 'TILING' })], false);

    expect(req.priceLists[0].items.map((i) => [i.trade, i.category])).toEqual([
      ['TILING', 'Підготовка'], ['TILING', 'Облицювання стін'], ['TILING', 'Підлога'], ['TILING', null],
    ]);
  });

  it('a price list defaults to the trade recognised most, an estimate to sorting by name', () => {
    expect(dominantTrade([
      { ...priceList.items[0], trade: 'TILING' }, { ...priceList.items[0], trade: 'TILING' },
      { ...priceList.items[0], trade: 'METAL' }, { ...priceList.items[0], trade: null },
    ])).toBe('TILING');
    expect(dominantTrade([{ ...priceList.items[0], trade: null }])).toBe('');
  });

  it('an estimate keeps its rooms out of the catalog folders', () => {
    const req = toCommitRequest([card({ trade: 'TILING' })], false);
    expect(req.estimates[0].items[0]).toMatchObject({ trade: 'TILING', section: 'Кухня', category: 'Підлога' });
  });

  it('«оновити ціни» is the batch policy', () => {
    expect(toCommitRequest([card({})], true).defaultPolicy).toBe('UPDATE_PRICE');
  });

  it('the new object is named off the paper, then its address, then the file', () => {
    expect(defaultObjectName(estimate, 'x.pdf')).toBe('Квартира, Франка 12');
    expect(defaultObjectName({ ...estimate, objectName: null }, 'x.pdf')).toBe('вул. Франка 12');
    expect(defaultObjectName({ ...estimate, objectName: null, address: null }, 'Франка 12.pdf')).toBe('Франка 12');
  });
});
