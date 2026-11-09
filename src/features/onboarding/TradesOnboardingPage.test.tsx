import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/lib/i18n.ts';
import { TradesOnboardingPage } from './TradesOnboardingPage.tsx';
import {
  needsTradesScreen, pendingTradesAnswer, rememberTradesAnswer, useTradesAnswerSync,
} from './tradesOnboarding.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { profileApi } from '@/api/profile.ts';
import { aUser } from '@/test/factories.ts';
import { toast } from '@/hooks/useToast.ts';
import { tokens } from '@/lib/tokens.ts';
import type { UserResponse } from '@/api/types.ts';

vi.mock('@/api/profile.ts', () => ({
  profileApi: { updateTrades: vi.fn(), addCustomTrade: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const fresh = aUser({ id: 'u-new', fullName: undefined, phone: undefined, companyName: undefined, trades: [] });

function renderScreen(from?: string, opts: { me?: typeof fresh; redirected?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, opts.me ?? fresh);
  const state = from || opts.redirected ? { from, redirected: opts.redirected } : null;
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[{ pathname: '/welcome', state }]}>
        <Routes>
          <Route path="/welcome" element={<TradesOnboardingPage />} />
          <Route path="/" element={<p>home</p>} />
          <Route path="/projects/:id" element={<p>object</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(profileApi.updateTrades).mockImplementation(async (req) => ({ ...fresh, trades: req.trades }));
});

describe('TradesOnboardingPage — «Чим займаєтесь?» (V190)', () => {
  it('saves the picked trades in one request and goes home', async () => {
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: /Плитка/ }));
    fireEvent.click(screen.getByRole('button', { name: /Малярні/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Далі' }));

    expect(await screen.findByText('home')).toBeTruthy();
    expect(profileApi.updateTrades).toHaveBeenCalledWith({ trades: ['TILING', 'PAINTER'] });
  });

  it('goes back to the screen that sent him here', async () => {
    renderScreen('/projects/p1');

    fireEvent.click(screen.getByRole('button', { name: /Плитка/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Далі' }));

    expect(await screen.findByText('object')).toBeTruthy();
  });

  it('keeps «Далі» shut until something is picked — skipping is its own, explained step', () => {
    renderScreen();

    expect(screen.getByRole('button', { name: 'Далі' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: /Плитка/ }));
    expect(screen.getByRole('button', { name: 'Далі' })).toHaveProperty('disabled', false);
  });

  it('says what a skip costs before it happens, and «Вибрати напрям» keeps him here', async () => {
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Пропустити' }));
    const dialog = await screen.findByRole('dialog', { name: 'Без напряму шаблонів не буде' });
    expect(within(dialog).getByText(/кошторис доведеться складати з нуля/)).toBeTruthy();
    expect(within(dialog).getByText(/Профіль → Напрями роботи/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Вибрати напрям' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('heading', { name: 'Чим займаєтесь?' })).toBeTruthy();
    expect(needsTradesScreen(fresh)).toBe(true);
  });

  /** V193: the skip is the server's answer, sent with the trades he has — never a wipe. */
  it('a confirmed skip is saved on the server with the trades he already has, and leaves', async () => {
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Пропустити' }));
    const dialog = await screen.findByRole('dialog', { name: 'Без напряму шаблонів не буде' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Все одно пропустити' }));

    expect(await screen.findByText('home')).toBeTruthy();
    expect(profileApi.updateTrades).toHaveBeenCalledWith({ trades: [] });
  });

  it('creates a trade of his own alongside the picked ones', async () => {
    vi.mocked(profileApi.addCustomTrade).mockResolvedValue({
      ...fresh, customTrades: [{ id: 'ct1', name: 'Натяжні стелі', sortOrder: 0 }],
    });
    renderScreen();

    fireEvent.click(screen.getByText('+ Свій напрям'));
    fireEvent.change(screen.getByPlaceholderText('Напр. Натяжні стелі'), { target: { value: 'Натяжні стелі' } });
    fireEvent.click(screen.getByRole('button', { name: 'Додати' }));
    fireEvent.click(screen.getByRole('button', { name: 'Далі' }));

    expect(await screen.findByText('home')).toBeTruthy();
    expect(profileApi.updateTrades).toHaveBeenCalledWith({ trades: [] });
    expect(profileApi.addCustomTrade).toHaveBeenCalledWith('Натяжні стелі');
  });
});

describe('TradesOnboardingPage — sent here, but the trades are there after all', () => {
  it('steps back by itself when the gate redirected him and his trades already exist', async () => {
    renderScreen('/projects/p1', { me: aUser({ trades: ['ELECTRICAL'] }), redirected: true });
    expect(await screen.findByText('object')).toBeTruthy();
  });

  it('stays when opened on purpose (from the template picker), to add a trade', () => {
    renderScreen('/projects/p1', { me: aUser({ trades: ['ELECTRICAL'] }) });
    expect(screen.getByRole('heading', { name: 'Чим займаєтесь?' })).toBeTruthy();
  });
});

describe('needsTradesScreen', () => {
  it('asks only a master who never answered and has no trade at all', () => {
    expect(needsTradesScreen(fresh)).toBe(true);
    // A skip, or every trade unticked later in the profile: answered, never asked again.
    expect(needsTradesScreen({ ...fresh, tradesOnboardedAt: '2026-11-07T10:00:00Z' })).toBe(false);
    expect(needsTradesScreen(aUser({ trades: ['TILING'] }))).toBe(false);
    expect(needsTradesScreen(aUser({ trades: [], customTrades: [{ id: 'c', name: 'Стелі', sortOrder: 0 }] }))).toBe(false);
  });
});

/** Review: «Далі» and «Пропустити» are PUTs — offline they failed and the gate kept him on this screen. */
describe('TradesOnboardingPage — no connection never locks him out', () => {
  const offline = () => Promise.reject(new TypeError('Failed to fetch'));

  it('a skip with no connection lets him in, and is kept to send later', async () => {
    vi.mocked(profileApi.updateTrades).mockImplementation(offline);
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Пропустити' }));
    const dialog = await screen.findByRole('dialog', { name: 'Без напряму шаблонів не буде' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Все одно пропустити' }));

    expect(await screen.findByText('home')).toBeTruthy();
    expect(pendingTradesAnswer('u-new')).toEqual({ trades: [], customNames: [] });
    expect(needsTradesScreen(fresh)).toBe(false);
  });

  it('picked trades with no connection are kept too, and he is told they wait for the network', async () => {
    vi.mocked(profileApi.updateTrades).mockImplementation(offline);
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: /Плитка/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Далі' }));

    expect(await screen.findByText('home')).toBeTruthy();
    expect(pendingTradesAnswer('u-new')).toEqual({ trades: ['TILING'], customNames: [] });
    expect(toast.info).toHaveBeenCalledWith("Немає інтернету — напрями збережемо, щойно з'явиться мережа");
  });

  it('a refusal from the server still keeps him here with its message', async () => {
    vi.mocked(profileApi.updateTrades).mockRejectedValue(new Error('Щось пішло не так'));
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: /Плитка/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Далі' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Щось пішло не так'));
    expect(screen.queryByText('home')).toBeNull();
    expect(pendingTradesAnswer('u-new')).toBeNull();
  });
});

describe('useTradesAnswerSync', () => {
  function Sync() {
    useTradesAnswerSync();
    return null;
  }
  function mount(me: UserResponse) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(ME_QUERY_KEY, me);
    render(<QueryClientProvider client={qc}><Sync /></QueryClientProvider>);
  }

  beforeEach(() => {
    vi.spyOn(tokens, 'hasAny').mockReturnValue(false); // the cache is the truth here; no /me refetch
  });

  it('sends a 1.72.0 skip the server never heard of, then forgets it', async () => {
    localStorage.setItem('majstr.tradesSkipped.u-new', '1');
    mount(fresh);

    await waitFor(() => expect(profileApi.updateTrades).toHaveBeenCalledWith({ trades: [] }));
    await waitFor(() => expect(pendingTradesAnswer('u-new')).toBeNull());
  });

  it('sends an offline answer with its own trades', async () => {
    rememberTradesAnswer('u-new', { trades: ['TILING'], customNames: ['Стелі'] });
    vi.mocked(profileApi.addCustomTrade).mockResolvedValue(fresh);
    mount(fresh);

    await waitFor(() => expect(profileApi.updateTrades).toHaveBeenCalledWith({ trades: ['TILING'] }));
    await waitFor(() => expect(profileApi.addCustomTrade).toHaveBeenCalledWith('Стелі'));
    await waitFor(() => expect(pendingTradesAnswer('u-new')).toBeNull());
  });

  it('never overwrites an answer the server already has (another phone)', async () => {
    rememberTradesAnswer('u-new', { trades: [], customNames: [] });
    mount({ ...fresh, trades: ['PAINTER'] });

    await waitFor(() => expect(pendingTradesAnswer('u-new')).toBeNull());
    expect(profileApi.updateTrades).not.toHaveBeenCalled();
  });

  it('still offline: the answer is kept for the next connection', async () => {
    rememberTradesAnswer('u-new', { trades: [], customNames: [] });
    vi.mocked(profileApi.updateTrades).mockRejectedValue(new TypeError('Failed to fetch'));
    mount(fresh);

    await waitFor(() => expect(profileApi.updateTrades).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(pendingTradesAnswer('u-new')).toEqual({ trades: [], customNames: [] });
  });
});
