import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { TelegramOfferHost } from './TelegramOfferHost.tsx';
import { telegramOfferStore } from './telegramOffer.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { telegramApi } from '@/api/inbox.ts';
import { aUser } from '@/test/factories.ts';
import { tokens } from '@/lib/tokens.ts';
import type { TelegramStatus, UserResponse } from '@/api/types.ts';

vi.mock('@/api/inbox.ts', () => ({
  inboxApi: {},
  telegramApi: { status: vi.fn(), link: vi.fn(), unlink: vi.fn(), setNotifications: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

/** Verified, so the trial offer is not the one this send shows. */
const master = aUser({ id: 'u-tg', emailVerified: true, plan: 'FREE' });
const TITLE = 'Хочете одразу знати, коли клієнт підпише?';

function status(over: Partial<TelegramStatus> = {}): TelegramStatus {
  return { available: true, linked: false, botUsername: 'majstr_bot', notifications: true, ...over };
}

function renderHost(me: UserResponse = master) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, me);
  return render(<QueryClientProvider client={qc}><TelegramOfferHost /></QueryClientProvider>);
}

const send = () => act(() => { telegramOfferStore.afterSend(); });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(tokens, 'hasAny').mockReturnValue(false);
  localStorage.removeItem('majstr.telegramOfferSeen.u-tg');
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

describe('TelegramOfferHost — the bot offered after an estimate left the app', () => {
  it('nothing is asked before a send', () => {
    renderHost();
    expect(telegramApi.status).not.toHaveBeenCalled();
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('after a send, with a bot here and no chat linked, the sheet offers it — once', async () => {
    vi.mocked(telegramApi.status).mockResolvedValue(status());
    const { unmount } = renderHost();
    send();

    expect(await screen.findByText(TITLE)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Не зараз' }));
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    unmount();

    renderHost();
    send();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('«Підключити» opens the tab in the tap, then points it at the bot link', async () => {
    vi.mocked(telegramApi.status).mockResolvedValue(status());
    vi.mocked(telegramApi.link).mockResolvedValue('https://t.me/majstr_bot?start=abc');
    const tab = { location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    renderHost();
    send();

    fireEvent.click(await screen.findByRole('button', { name: 'Підключити' }));

    expect(open).toHaveBeenCalledWith('', '_blank'); // synchronously, before the await
    await waitFor(() => expect(tab.location.href).toBe('https://t.me/majstr_bot?start=abc'));
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    open.mockRestore();
  });

  it('a linked bot, or none on this server, offers nothing', async () => {
    vi.mocked(telegramApi.status).mockResolvedValue(status({ linked: true }));
    const { unmount } = renderHost();
    send();
    await waitFor(() => expect(telegramApi.status).toHaveBeenCalled());
    expect(screen.queryByText(TITLE)).toBeNull();
    unmount();

    vi.mocked(telegramApi.status).mockResolvedValue(status({ available: false }));
    renderHost();
    send();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('the trial offer goes first after the same send — two sheets never stack', async () => {
    renderHost(aUser({ id: 'u-tg', emailVerified: false, plan: 'FREE', trialStartedAt: null }));
    send();
    await new Promise((r) => setTimeout(r, 20));
    expect(telegramApi.status).not.toHaveBeenCalled();
    expect(screen.queryByText(TITLE)).toBeNull();
  });
});
