import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { HelpOfferCard } from './HelpOfferCard.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { profileApi } from '@/api/profile.ts';
import { aUser } from '@/test/factories.ts';
import { tokens } from '@/lib/tokens.ts';
import type { UserResponse } from '@/api/types.ts';

vi.mock('@/api/profile.ts', () => ({ profileApi: { requestHelp: vi.fn() } }));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const noPhone = aUser({ id: 'u-help', phone: undefined });

function renderCard(me: UserResponse) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, me);
  return render(<QueryClientProvider client={qc}><HelpOfferCard /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(tokens, 'hasAny').mockReturnValue(false); // the cache is the truth here; no /me refetch
  localStorage.removeItem('majstr.helpOfferDismissed.u-help');
});

describe('HelpOfferCard — «Залиште телефон — передзвонимо» (V191)', () => {
  it('offers a call to a master with no phone, and sends the number he types', async () => {
    vi.mocked(profileApi.requestHelp).mockResolvedValue({ ...noPhone, phone: '+380501112233', helpRequestedAt: '2026-11-07T10:00:00Z' });
    renderCard(noPhone);

    fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: ' +380501112233 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Передзвоніть мені' }));

    await waitFor(() => expect(profileApi.requestHelp).toHaveBeenCalledWith({ phone: '+380501112233' }));
    expect(await screen.findByText('Дякуємо! Ми передзвонимо найближчим часом.')).toBeTruthy();
  });

  it('refuses a number too short to be one, and sends nothing', () => {
    renderCard(noPhone);

    fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Передзвоніть мені' }));

    expect(screen.getByText('Введіть телефон')).toBeTruthy();
    expect(profileApi.requestHelp).not.toHaveBeenCalled();
  });

  it('«Ні, дякую» hides it for good on this device', () => {
    const { unmount } = renderCard(noPhone);
    fireEvent.click(screen.getByRole('button', { name: 'Ні, дякую' }));
    expect(screen.queryByText('Потрібна допомога з налаштуванням?')).toBeNull();
    unmount();

    renderCard(noPhone);
    expect(screen.queryByText('Потрібна допомога з налаштуванням?')).toBeNull();
  });

  it('says nothing to a master who already left a phone or already asked', () => {
    renderCard(aUser({ phone: '+380501112233' }));
    expect(screen.queryByText('Потрібна допомога з налаштуванням?')).toBeNull();

    renderCard({ ...noPhone, helpRequestedAt: '2026-11-07T10:00:00Z' });
    expect(screen.queryByText('Потрібна допомога з налаштуванням?')).toBeNull();
  });
});
