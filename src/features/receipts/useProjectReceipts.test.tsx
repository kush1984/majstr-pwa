import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { projectReceiptsApi } from '@/api/projectReceipts.ts';
import { useDeleteProjectReceipt, useUpdateProjectReceipt } from './useProjectReceipts.ts';
import type { ProjectReceiptResponse, ProjectReceiptsResponse } from '@/api/types.ts';

/**
 * The cached list is `{ items, totals }`. Both writers once patched it as an array, so every edit —
 * «Клієнт відшкодовує» → «моя витрата» among them — failed with «old?.map is not a function» AFTER
 * the server had already saved it. The page test mocks these hooks, so only a real cache sees it.
 */

vi.mock('@/api/projectReceipts.ts', () => ({
  projectReceiptsApi: { list: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));

const row = (id: string, over: Partial<ProjectReceiptResponse> = {}): ProjectReceiptResponse => ({
  id, label: 'Епіцентр', amount: 482.75, issuedAt: null, hasPhoto: true, reimbursable: true,
  sortOrder: 0, ...over,
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const list: ProjectReceiptsResponse = {
    items: [row('r1'), row('r2')], reimbursableTotal: 965.5, ownTotal: 0, unpricedCount: 0,
  };
  qc.setQueryData(['project-receipts', 'p1'], list);
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const cached = () => qc.getQueryData<ProjectReceiptsResponse>(['project-receipts', 'p1']);
  return { wrapper, cached };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(projectReceiptsApi.list).mockReturnValue(new Promise(() => {}));
});

describe('project receipt writers', () => {
  it('an edit lands in the cached list in place, totals kept until the refetch', async () => {
    const { wrapper, cached } = setup();
    vi.mocked(projectReceiptsApi.update).mockResolvedValue(row('r1', { reimbursable: false }));
    const { result } = renderHook(() => useUpdateProjectReceipt('p1'), { wrapper });

    await act(() => result.current.mutateAsync({
      receiptId: 'r1', req: { label: 'Епіцентр', amount: 482.75, reimbursable: false },
    }));

    expect(cached()?.items.map((r) => [r.id, r.reimbursable])).toEqual([['r1', false], ['r2', true]]);
    expect(cached()?.reimbursableTotal).toBe(965.5);
  });

  it('a delete drops the row from the cached list at once', async () => {
    const { wrapper, cached } = setup();
    vi.mocked(projectReceiptsApi.remove).mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteProjectReceipt('p1'), { wrapper });

    await act(() => result.current.mutateAsync('r1'));

    expect(cached()?.items.map((r) => r.id)).toEqual(['r2']);
  });
});
