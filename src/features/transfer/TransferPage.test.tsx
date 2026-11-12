import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { TransferPage, toCommitRequest, defaultObjectName, type TransferCard } from './TransferPage.tsx';
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
    expect(screen.getByText('1 без одиниці виміру — не перенесемо')).toBeTruthy();
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

  it('one unreadable file costs only itself', async () => {
    vi.mocked(transferApi.parseFile).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(priceList);
    renderPage();
    pick([new File(['x'], 'bad.pdf'), new File(['x'], 'prais.xlsx')]);

    expect(await screen.findByText('📎 bad.pdf')).toBeTruthy();
    expect(screen.getByText('1 позицій → у каталог')).toBeTruthy();
  });
});

describe('toCommitRequest', () => {
  const card = (over: Partial<TransferCard>): TransferCard => ({
    key: 1, fileName: 'f.pdf', parsed: estimate, error: null, choice: 'ESTIMATE', projectId: '',
    objectName: 'Обʼєкт', estimateName: '', toCatalog: true, ...over,
  });

  it('an existing object carries its id and none of the new-object meta', () => {
    const req = toCommitRequest([card({ projectId: 'p-9' })], false);
    expect(req.estimates[0]).toMatchObject({ projectId: 'p-9', objectName: null, clientName: null, address: null });
    expect(req.defaultPolicy).toBe('SKIP');
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
