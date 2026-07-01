import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { UpgradeBanner } from '@/components/UpgradeBanner.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { upgradeApi } from '@/api/upgrade.ts';
import type { UserResponse } from '@/api/types.ts';

vi.mock('@/api/upgrade.ts', () => ({
  upgradeApi: { click: vi.fn(() => Promise.resolve()), interest: vi.fn(() => Promise.resolve()) },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const me: UserResponse = {
  id: 'u1', email: 'master@e.com', fullName: 'M', trades: ['ELECTRICAL'], phone: '1',
  companyName: 'C', logoUrl: null, plan: 'FREE', role: 'USER', emailVerified: true,
  createdAt: '2026-01-01', consentedToPrivacyAt: '2026-01-01', acknowledgedClientDataAt: '2026-01-01',
};

function renderBanner() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, me);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<UpgradeBanner text="Ліміт вичерпано" trigger="OBJECT_LIMIT" />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('UpgradeBanner — painted door', () => {
  it('records the click with its trigger, opens the modal, then records interest', async () => {
    const { container } = renderBanner();

    // Click the CTA → click recorded with the trigger + painted-door modal opens.
    fireEvent.click(screen.getByRole('button', { name: /PRO/ }));
    expect(upgradeApi.click).toHaveBeenCalledWith('OBJECT_LIMIT');
    expect(await screen.findByText('PRO ще готуємо')).toBeTruthy();

    // Submit interest with a reason → interest recorded → thank-you screen.
    fireEvent.change(container.querySelector('#upgrade-reason')!, {
      target: { value: 'потрібен командний доступ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Так, цікавить' }));
    await waitFor(() =>
      expect(upgradeApi.interest).toHaveBeenCalledWith('потрібен командний доступ'),
    );
    expect(await screen.findByText('Дякуємо!')).toBeTruthy();
  });
});
