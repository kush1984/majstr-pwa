import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ItemForm } from './ItemForm.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { catalogApi } from '@/api/catalog.ts';
import { aUser } from '@/test/factories.ts';
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

function renderForm(initial: EstimateItemResponse) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, aUser());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <ItemForm initial={initial} submitLabel="Зберегти" submitting={false} onSubmit={vi.fn()} />,
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
