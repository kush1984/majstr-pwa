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

const DAY = 24 * 60 * 60 * 1000;
/** Registered two days ago, still no object: the master the card is for. */
const stuck = aUser({ id: 'u-help', phone: undefined, createdAt: new Date(Date.now() - 2 * DAY).toISOString() });

function renderCard(me: UserResponse, hasObjects = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, me);
  return render(<QueryClientProvider client={qc}><HelpOfferCard hasObjects={hasObjects} /></QueryClientProvider>);
}

const TITLE = 'Потрібна допомога з налаштуванням?';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(tokens, 'hasAny').mockReturnValue(false); // the cache is the truth here; no /me refetch
  localStorage.removeItem('majstr.helpOfferDismissed.u-help');
});

describe('HelpOfferCard — «Залиште телефон — передзвонимо» (V191)', () => {
  it('offers a call to a stuck master, says the number is only for the call, and sends it normalised', async () => {
    vi.mocked(profileApi.requestHelp).mockResolvedValue({ ...stuck, helpRequestedAt: '2026-11-07T10:00:00Z' });
    renderCard(stuck);

    expect(screen.getByText('Лише для дзвінка — у ваші документи номер не потрапить.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '050 111 22 33' } });
    fireEvent.click(screen.getByRole('button', { name: 'Передзвоніть мені' }));

    await waitFor(() => expect(profileApi.requestHelp).toHaveBeenCalledWith({ phone: '+380501112233' }));
    expect(await screen.findByText('Дякуємо! Ми передзвонимо найближчим часом.')).toBeTruthy();
  });

  it('refuses a number that cannot be called, and sends nothing', () => {
    renderCard(stuck);

    fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '512 345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Передзвоніть мені' }));

    expect(screen.getByText('Перевірте номер, наприклад 067 123 45 67')).toBeTruthy();
    expect(profileApi.requestHelp).not.toHaveBeenCalled();
  });

  it('«Ні, дякую» hides it for good on this device', () => {
    const { unmount } = renderCard(stuck);
    fireEvent.click(screen.getByRole('button', { name: 'Ні, дякую' }));
    expect(screen.queryByText(TITLE)).toBeNull();
    unmount();

    renderCard(stuck);
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  /** Review: not on the first visit — it would push «Новий обʼєкт» down for someone who tried nothing. */
  it('waits until he is stuck: not on day one, not once he has an object, not after he asked', () => {
    renderCard({ ...stuck, createdAt: new Date().toISOString() });
    expect(screen.queryByText(TITLE)).toBeNull();

    renderCard(stuck, true);
    expect(screen.queryByText(TITLE)).toBeNull();

    renderCard({ ...stuck, helpRequestedAt: '2026-11-07T10:00:00Z' });
    expect(screen.queryByText(TITLE)).toBeNull();
  });
});
