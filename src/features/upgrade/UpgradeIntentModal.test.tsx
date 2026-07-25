import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { UpgradeIntentModal } from './UpgradeIntentModal.tsx';
import { billingApi } from '@/api/billing.ts';
import { toast } from '@/hooks/useToast.ts';

vi.mock('@/api/billing.ts', () => ({
  billingApi: { checkout: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(billingApi.checkout).mockResolvedValue({ pageUrl: 'http://pay' });
});

function withQuery(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe('UpgradeIntentModal — period selection', () => {
  it('defaults to the monthly period', async () => {
    render(<UpgradeIntentModal open onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Оплатити' }));
    await waitFor(() => expect(billingApi.checkout).toHaveBeenCalledWith('MONTH', true));
  });

  it('sends HALF_YEAR when the 6-month card is chosen', async () => {
    render(<UpgradeIntentModal open onClose={() => {}} />);
    fireEvent.click(screen.getByText('6 місяців'));
    fireEvent.click(screen.getByRole('button', { name: 'Оплатити' }));
    await waitFor(() => expect(billingApi.checkout).toHaveBeenCalledWith('HALF_YEAR', true));
  });

  it('sends YEAR when the 12-month card is chosen, with the annual renewal hint', async () => {
    render(<UpgradeIntentModal open onClose={() => {}} />);
    fireEvent.click(screen.getByText('12 місяців'));
    // The per-month saving is what sells the longer period — it must be on screen.
    expect(screen.getByText(/229 ₴\/міс/)).toBeTruthy();
    // The auto-renew hint follows the chosen period (yearly, not monthly).
    expect(screen.getByText(/Щороку списуватимемо 2748 ₴/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Оплатити' }));
    await waitFor(() => expect(billingApi.checkout).toHaveBeenCalledWith('YEAR', true));
  });

  it('passes autoRenew=false when the checkbox is unticked', async () => {
    render(<UpgradeIntentModal open onClose={() => {}} />);
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
