import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/lib/i18n.ts';
import { UpgradeIntentModal } from './UpgradeIntentModal.tsx';
import { billingApi } from '@/api/billing.ts';

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

  it('passes autoRenew=false when the checkbox is unticked', async () => {
    render(<UpgradeIntentModal open onClose={() => {}} />);
    fireEvent.click(screen.getByRole('checkbox')); // default on → off
    fireEvent.click(screen.getByRole('button', { name: 'Оплатити' }));
    await waitFor(() => expect(billingApi.checkout).toHaveBeenCalledWith('MONTH', false));
  });
});
