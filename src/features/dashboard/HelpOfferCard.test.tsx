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

vi.mock('@/api/profile.ts', () => ({ profileApi: { requestHelp: vi.fn(), helpOffer: vi.fn() } }));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const master = aUser({ id: 'u-help', phone: undefined });

function renderCard(me: UserResponse) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, me);
  return render(<QueryClientProvider client={qc}><HelpOfferCard /></QueryClientProvider>);
}

const TITLE = 'Потрібна допомога з налаштуванням?';
const TITLE_NOT_SENT = 'Застрягли з першим кошторисом для клієнта?';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(tokens, 'hasAny').mockReturnValue(false); // the cache is the truth here; no /me refetch
  localStorage.removeItem('majstr.helpOfferDismissed.u-help');
  vi.mocked(profileApi.helpOffer).mockResolvedValue({ reason: 'NO_OBJECT', phone: null });
});

describe('HelpOfferCard — «Залиште телефон — передзвонимо» (V191, V226)', () => {
  it('offers a call when the server says so, says the number is only for the call, and sends it normalised', async () => {
    vi.mocked(profileApi.requestHelp).mockResolvedValue({ ...master, helpRequestedAt: '2026-11-07T10:00:00Z' });
    renderCard(master);

    expect(await screen.findByText(TITLE)).toBeTruthy();
    expect(screen.getByText('Лише для дзвінка — у ваші документи номер не потрапить.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '050 111 22 33' } });
    fireEvent.click(screen.getByRole('button', { name: 'Передзвоніть мені' }));

    await waitFor(() => expect(profileApi.requestHelp).toHaveBeenCalledWith({ phone: '+380501112233' }));
    expect(await screen.findByText('Дякуємо! Ми передзвонимо найближчим часом.')).toBeTruthy();
  });

  it('a week in with nothing sent to a client has its own words, and starts with his Telegram number', async () => {
    vi.mocked(profileApi.helpOffer).mockResolvedValue({ reason: 'NOT_SENT', phone: '+380671112233' });
    vi.mocked(profileApi.requestHelp).mockResolvedValue({ ...master, helpRequestedAt: '2026-11-07T10:00:00Z' });
    renderCard(master);

    expect(await screen.findByText(TITLE_NOT_SENT)).toBeTruthy();
    expect(screen.getByText('Залиште номер — допоможемо за 10 хвилин.')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Телефон').value).toBe('+380671112233');

    fireEvent.click(screen.getByRole('button', { name: 'Передзвоніть мені' }));
    await waitFor(() => expect(profileApi.requestHelp).toHaveBeenCalledWith({ phone: '+380671112233' }));
  });

  it('refuses a number that cannot be called, and sends nothing', async () => {
    renderCard(master);

    fireEvent.change(await screen.findByLabelText('Телефон'), { target: { value: '512 345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Передзвоніть мені' }));

    expect(screen.getByText('Перевірте номер, наприклад 067 123 45 67')).toBeTruthy();
    expect(profileApi.requestHelp).not.toHaveBeenCalled();
  });

  it('«Ні, дякую» hides it for good on this device', async () => {
    const { unmount } = renderCard(master);
    fireEvent.click(await screen.findByRole('button', { name: 'Ні, дякую' }));
    expect(screen.queryByText(TITLE)).toBeNull();
    unmount();

    renderCard(master);
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(profileApi.helpOffer).toHaveBeenCalledTimes(1); // not even asked again
  });

  it('no card when the server offers none, and no question at all once he asked', async () => {
    vi.mocked(profileApi.helpOffer).mockResolvedValue(null);
    renderCard(master);
    await waitFor(() => expect(profileApi.helpOffer).toHaveBeenCalled());
    expect(screen.queryByText(TITLE)).toBeNull();

    vi.mocked(profileApi.helpOffer).mockClear();
    renderCard({ ...master, helpRequestedAt: '2026-11-07T10:00:00Z' });
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(profileApi.helpOffer).not.toHaveBeenCalled();
  });
});
