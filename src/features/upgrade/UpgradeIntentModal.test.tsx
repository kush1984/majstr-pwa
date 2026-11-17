import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { UpgradeIntentModal } from './UpgradeIntentModal.tsx';
import { billingApi } from '@/api/billing.ts';
import { toast } from '@/hooks/useToast.ts';
import { PLAN_LIMITS_KEY } from '@/features/plan/usePlanLimits.ts';
import { aPlanLimits } from '@/test/factories.ts';
import type { PlanLimits } from '@/api/types.ts';

vi.mock('@/api/billing.ts', () => ({
  billingApi: { checkout: vi.fn(), checkoutObject: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(billingApi.checkout).mockResolvedValue({ pageUrl: 'http://pay' });
  vi.mocked(billingApi.checkoutObject).mockResolvedValue({ pageUrl: 'http://pay-object' });
});

function withQuery(node: ReactNode, limits?: PlanLimits) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (limits) qc.setQueryData(PLAN_LIMITS_KEY, limits);
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe('UpgradeIntentModal — period selection', () => {
  it('defaults to the monthly period', async () => {
    render(withQuery(<UpgradeIntentModal open onClose={() => {}} />));
    fireEvent.click(screen.getByRole('button', { name: 'Оплатити' }));
    await waitFor(() => expect(billingApi.checkout).toHaveBeenCalledWith('MONTH', true));
  });

  it('sends HALF_YEAR when the 6-month card is chosen', async () => {
    render(withQuery(<UpgradeIntentModal open onClose={() => {}} />));
    fireEvent.click(screen.getByText('6 місяців'));
    fireEvent.click(screen.getByRole('button', { name: 'Оплатити' }));
    await waitFor(() => expect(billingApi.checkout).toHaveBeenCalledWith('HALF_YEAR', true));
  });

  it('sends YEAR when the 12-month card is chosen, with the annual renewal hint', async () => {
    render(withQuery(<UpgradeIntentModal open onClose={() => {}} />));
    fireEvent.click(screen.getByText('12 місяців'));
    // The per-month saving is what sells the longer period — it must be on screen.
    expect(screen.getByText(/229 ₴\/міс/)).toBeTruthy();
    // The auto-renew hint follows the chosen period (yearly, not monthly).
    expect(screen.getByText(/Щороку списуватимемо 2748 ₴/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Оплатити' }));
    await waitFor(() => expect(billingApi.checkout).toHaveBeenCalledWith('YEAR', true));
  });

  it('passes autoRenew=false when the checkbox is unticked', async () => {
    render(withQuery(<UpgradeIntentModal open onClose={() => {}} />));
    fireEvent.click(screen.getByRole('checkbox')); // default on → off
    fireEvent.click(screen.getByRole('button', { name: 'Оплатити' }));
    await waitFor(() => expect(billingApi.checkout).toHaveBeenCalledWith('MONTH', false));
  });

  it('routes to the verify modal (not a toast) when checkout returns EMAIL_NOT_VERIFIED', async () => {
    vi.mocked(billingApi.checkout).mockRejectedValue({
      isAxiosError: true,
      response: { status: 403, data: { status: 403, code: 'EMAIL_NOT_VERIFIED', message: 'x' } },
    });
    const onClose = vi.fn();
    render(withQuery(<UpgradeIntentModal open onClose={onClose} />));

    fireEvent.click(screen.getByRole('button', { name: 'Оплатити' }));

    // Closes the upgrade modal and opens the verify flow; no bare error toast.
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('UpgradeIntentModal — PRO, one object, or the choice (V214)', () => {
  const free = aPlanLimits({ plan: 'FREE', maxProjects: 2, projectsUsed: 2, objectPrice: 149 });

  it('at the object cap: «Обрати тариф», two tabs, starting on the object, which buys the object', async () => {
    render(withQuery(<UpgradeIntentModal open onClose={() => {}} mode="choice" />, free));

    expect(screen.getByText('Обрати тариф')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Один обʼєкт · 149 ₴' }).getAttribute('aria-selected')).toBe('true');
    // Both panels stay mounted in one grid cell (the sheet keeps its size); PRO's is hidden.
    expect(screen.getByText('6 місяців').closest('[aria-hidden]')?.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Оплатити 149 ₴' }));

    await waitFor(() => expect(billingApi.checkoutObject).toHaveBeenCalled());
    expect(billingApi.checkout).not.toHaveBeenCalled();
  });

  it('in the choice, the PRO tab pays for PRO', async () => {
    render(withQuery(<UpgradeIntentModal open onClose={() => {}} mode="choice" />, free));

    fireEvent.click(screen.getByRole('tab', { name: 'PRO · підписка' }));
    fireEvent.click(screen.getByRole('button', { name: 'Оплатити' }));

    await waitFor(() => expect(billingApi.checkout).toHaveBeenCalledWith('MONTH', true));
    expect(billingApi.checkoutObject).not.toHaveBeenCalled();
  });

  it('«Оновити до PRO» shows PRO alone — no object, no tabs', () => {
    render(withQuery(<UpgradeIntentModal open onClose={() => {}} mode="pro" />, free));

    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByText('Оновити до PRO')).toBeTruthy();
    expect(screen.queryByText('Кошториси без обмежень')).toBeNull();
  });

  it('«Купити обʼєкт разово» shows the object alone — no PRO periods, no tabs', async () => {
    render(withQuery(<UpgradeIntentModal open onClose={() => {}} mode="object" />, free));

    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByText('Купити обʼєкт разово')).toBeTruthy();
    expect(screen.queryByText('6 місяців')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Оплатити 149 ₴' }));
    await waitFor(() => expect(billingApi.checkoutObject).toHaveBeenCalled());
  });

  it('a paying master sees PRO alone whatever was asked', () => {
    render(withQuery(<UpgradeIntentModal open onClose={() => {}} mode="object" />, { ...free, plan: 'PRO' }));

    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByText('Оновити до PRO')).toBeTruthy();
  });

  it('says PRO is cheaper once an object was already bought this month', () => {
    render(withQuery(
      <UpgradeIntentModal open onClose={() => {}} mode="object" />,
      { ...free, objectsBoughtLastMonth: 1 },
    ));
    expect(screen.getByText(/PRO за 299 ₴ вигідніший/)).toBeTruthy();
  });
});
