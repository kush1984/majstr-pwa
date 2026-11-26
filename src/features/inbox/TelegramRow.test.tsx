import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { TelegramRow } from './TelegramRow.tsx';
import { TELEGRAM_KEY } from './useInbox.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { telegramApi } from '@/api/inbox.ts';
import { profileApi } from '@/api/profile.ts';
import { aUser } from '@/test/factories.ts';
import { tokens } from '@/lib/tokens.ts';
import type { TelegramStatus, UserResponse } from '@/api/types.ts';

vi.mock('@/api/inbox.ts', () => ({
  inboxApi: {},
  telegramApi: { status: vi.fn(), link: vi.fn(), unlink: vi.fn(), setNotifications: vi.fn() },
}));
vi.mock('@/api/profile.ts', () => ({ profileApi: { phoneFromTelegram: vi.fn() } }));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const linked: TelegramStatus = { available: true, linked: true, username: 'andriy', botUsername: 'majstr_bot', notifications: true };

function renderRow(status: TelegramStatus, me: UserResponse = aUser({ phone: '+380501112233' })) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(TELEGRAM_KEY, status);
  qc.setQueryData(ME_QUERY_KEY, me);
  vi.mocked(telegramApi.status).mockResolvedValue(status);
  return render(<QueryClientProvider client={qc}><TelegramRow /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(tokens, 'hasAny').mockReturnValue(false);
});

describe('TelegramRow — the bot in the profile (iteration-master-contact)', () => {
  it('not linked: says notifications come first, then voice notes', () => {
    renderRow({ ...linked, linked: false, username: undefined });
    expect(screen.getByText(/Одразу скаже, коли клієнт підпише кошторис/)).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('linked: «Сповіщення в Telegram» switches off and back with one tap on the whole line', async () => {
    vi.mocked(telegramApi.setNotifications).mockResolvedValue({ ...linked, notifications: false });
    renderRow(linked);

    const toggle = screen.getByRole('switch', { name: /Сповіщення в Telegram/ });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);

    await waitFor(() => expect(telegramApi.setNotifications).toHaveBeenCalledWith({ enabled: false }));
    await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false'));
  });

  it('the Telegram number is offered for the documents only while the profile has none, and only by a tap', async () => {
    const noPhone = aUser({ phone: undefined, contactPhone: '+380671112233' });
    vi.mocked(profileApi.phoneFromTelegram).mockResolvedValue({ ...noPhone, phone: '+380671112233' });
    renderRow(linked, noPhone);

    expect(screen.getByText('Додати номер +380671112233 із Telegram до документів?')).toBeTruthy();
    expect(profileApi.phoneFromTelegram).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Додати' }));

    await waitFor(() => expect(profileApi.phoneFromTelegram).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('telegram-phone-offer')).toBeNull());
  });

  it('no offer once the profile has a phone', () => {
    renderRow(linked, aUser({ phone: '+380501112233', contactPhone: '+380671112233' }));
    expect(screen.queryByTestId('telegram-phone-offer')).toBeNull();
  });
});
