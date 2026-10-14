import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { useRemoveItem, useUpdateItem, resetSentChangeNotice, ESTIMATE_KEY } from './useEstimate.ts';
import { clearOutbox } from '@/lib/outbox/outbox.ts';
import { estimatesApi } from '@/api/estimates.ts';
import { toast } from '@/hooks/useToast.ts';
import type { EstimateResponse, EstimateStatus } from '@/api/types.ts';

vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('@/api/estimates.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/estimates.ts')>();
  return { estimatesApi: { ...mod.estimatesApi, removeItem: vi.fn(), updateItem: vi.fn(), get: vi.fn() } };
});

const EID = 'est-sent';

function setup(status: EstimateStatus) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const est: EstimateResponse = {
    id: EID, projectId: 'p1', name: null, status, validUntil: null, notes: null,
    createdAt: '', updatedAt: '',
    items: ['i1', 'i2'].map((id, n) => ({
      id, type: 'WORK', name: `Робота ${n}`, category: null, unit: 'M2',
      quantity: 2, unitPrice: 100, lineTotal: 200, sortOrder: n, measurementRefs: [], quantityManual: false,
      percentBaseKind: null, percentBaseItemId: null, baseDetached: false, baseOriginLabel: null, closedByActs: null,
    })),
    worksSubtotal: 400, materialsSubtotal: 0, total: 400, depositAmount: null, balance: 400,
  };
  qc.setQueryData<EstimateResponse>([...ESTIMATE_KEY, EID], est);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetSentChangeNotice();
  await clearOutbox();
  vi.mocked(estimatesApi.removeItem).mockResolvedValue(undefined);
  vi.mocked(estimatesApi.updateItem).mockResolvedValue({} as never);
});
afterEach(() => onlineManager.setOnline(true));

/**
 * A SENT estimate's first changed line says the client reads the change at the same link — once per
 * estimate, whatever door changed it; a DRAFT says nothing.
 */
describe('the «client sees it at the same link» hint', () => {
  it('fires on the first change of a SENT estimate and not on the second', async () => {
    const { wrapper } = setup('SENT');
    const remove = renderHook(() => useRemoveItem(EID), { wrapper }).result;
    const update = renderHook(() => useUpdateItem(EID), { wrapper }).result;

    await act(async () => { await remove.current.mutateAsync('i1'); });
    await act(async () => {
      await update.current.mutateAsync({
        itemId: 'i2', req: { type: 'WORK', name: 'Робота 1', unit: 'M2', quantity: 3, unitPrice: 100 },
      });
    });

    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith('Клієнт побачить зміну за тим самим посиланням');
  });

  it('says nothing for a DRAFT', async () => {
    const { wrapper } = setup('DRAFT');
    const remove = renderHook(() => useRemoveItem(EID), { wrapper }).result;

    await act(async () => { await remove.current.mutateAsync('i1'); });

    expect(toast.info).not.toHaveBeenCalled();
  });

  it('offline, it does not promise the change is live — it waits in the queue', async () => {
    onlineManager.setOnline(false);
    const { wrapper } = setup('SENT');
    const remove = renderHook(() => useRemoveItem(EID), { wrapper }).result;

    await act(async () => { await remove.current.mutateAsync('i1'); });

    expect(toast.info).toHaveBeenCalledWith('Після синхронізації клієнт побачить зміну за тим самим посиланням');
  });
});
