import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { SettingsModal } from './SettingsModal.tsx';
import { ProfileEditModal } from './ProfileEditModal.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { profileApi } from '@/api/profile.ts';
import type { UserResponse } from '@/api/types.ts';
import { aUser } from '@/test/factories.ts';

vi.mock('@/api/profile.ts', () => ({
  profileApi: {
    update: vi.fn(),
    updateRequisites: vi.fn(),
    uploadLogo: vi.fn(),
    deleteLogo: vi.fn(),
    addCustomTrade: vi.fn(),
    renameCustomTrade: vi.fn(),
    deleteCustomTrade: vi.fn(),
  },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const me: UserResponse = aUser({
  emailVerified: true,
  legalName: 'ФОП Петренко Іван',
  iban: 'UA213223130000026007233566001',
  payoutCard: '4111111111111111',
});

function renderWith(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, me);
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('«Налаштування» — requisites and where a client pays (V217)', () => {
  it('shows what is saved, grouped by four, and saves requisites with the payout on their own endpoint', async () => {
    vi.mocked(profileApi.updateRequisites).mockResolvedValue(me);
    const onClose = vi.fn();
    renderWith(<SettingsModal open onClose={onClose} />);

    expect(screen.getByDisplayValue('4111 1111 1111 1111')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Посилання на оплату/), { target: { value: 'https://www.liqpay.ua/pay/x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(profileApi.updateRequisites).toHaveBeenCalledWith(expect.objectContaining({
      legalName: 'ФОП Петренко Іван',
      iban: 'UA213223130000026007233566001',
      payoutCard: '4111 1111 1111 1111',
      payoutLink: 'https://www.liqpay.ua/pay/x',
    }));
    expect(profileApi.update).not.toHaveBeenCalled();
  });

  it('says what the QR still needs, and warns about a card that fails the check', () => {
    renderWith(<SettingsModal open onClose={() => {}} />);

    expect(screen.getByText(/Додайте IBAN і РНОКПП/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/РНОКПП/), { target: { value: '1234567890' } });
    expect(screen.getByText(/клієнт побачить QR-код/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Номер картки/), { target: { value: '4111 1111 1111 1112' } });
    expect(screen.getByText('Номер картки не схожий на справжній — перевірте цифри')).toBeTruthy();
  });

  it('the profile form no longer carries the requisites, so saving it cannot blank them', async () => {
    vi.mocked(profileApi.update).mockResolvedValue(me);
    renderWith(<ProfileEditModal open onClose={() => {}} />);

    expect(screen.queryByText('Реквізити для документів')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    await waitFor(() => expect(profileApi.update).toHaveBeenCalled());
    const body = vi.mocked(profileApi.update).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(body).not.toHaveProperty('iban');
    expect(body).not.toHaveProperty('legalName');
  });
});
