import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { BillingReturnPage } from './BillingReturnPage.tsx';
import { PLAN_LIMITS_KEY } from '@/features/plan/usePlanLimits.ts';
import { aPlanLimits } from '@/test/factories.ts';
import type { PlanLimits } from '@/api/types.ts';

function renderAt(path: string, limits: PlanLimits) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(PLAN_LIMITS_KEY, limits);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <BillingReturnPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BillingReturnPage — one object without a subscription (V214)', () => {
  it('once the credit has landed, sends the master to create the paid object', () => {
    renderAt('/billing/return?for=object', aPlanLimits({ objectCredits: 1 }));

    expect(screen.getByText('Обʼєкт оплачено!')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Створити обʼєкт' }).getAttribute('href')).toBe('/projects/new');
  });

  it('waits while the credit has not landed yet, and never claims PRO', () => {
    renderAt('/billing/return?for=object', aPlanLimits({ objectCredits: 0 }));

    expect(screen.getByText('Оплата обробляється…')).toBeTruthy();
    expect(screen.queryByText('PRO активовано!')).toBeNull();
  });
});
