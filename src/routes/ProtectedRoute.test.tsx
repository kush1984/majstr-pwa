import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ProtectedRoute, PublicOnlyRoute } from './ProtectedRoute.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { tokens } from '@/lib/tokens.ts';
import { authApi } from '@/api/auth.ts';
import type { UserResponse } from '@/api/types.ts';
import { aUser } from '@/test/factories.ts';

vi.mock('@/api/auth.ts', () => ({ authApi: { me: vi.fn() } }));

const me: UserResponse = aUser({ fullName: 'Денис' });

beforeEach(() => {
  vi.clearAllMocks();
  tokens.set('access-token', 'refresh-token');
});
afterEach(() => {
  tokens.clear();
  onlineManager.setOnline(true);
});

/** Tiny route table: `/` home, `/login` behind PublicOnlyRoute, `/app` behind ProtectedRoute. */
function renderAt(path: string, seedMe?: UserResponse) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seedMe) qc.setQueryData(ME_QUERY_KEY, seedMe);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<div>HOME</div>} />
          <Route path="/login" element={<PublicOnlyRoute><div>LOGIN PAGE</div></PublicOnlyRoute>} />
          <Route path="/app" element={<ProtectedRoute><div>APP CONTENT</div></ProtectedRoute>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Prod report: with no connection the app hung on a spinner and never showed the login page.
describe('auth gate — offline behaviour', () => {
  it('lets a CACHED user into the app even when /me fails (offline)', () => {
    onlineManager.setOnline(false);
    vi.mocked(authApi.me).mockRejectedValue(new Error('offline'));

    renderAt('/app', me);

    // The offline cache is enough — the master keeps working in a basement.
    expect(screen.getByText('APP CONTENT')).toBeTruthy();
  });

  it('renders the LOGIN page offline instead of hanging on a spinner', () => {
    onlineManager.setOnline(false);
    vi.mocked(authApi.me).mockRejectedValue(new Error('offline'));

    // Leftover tokens + offline: /me can never resolve, so the gate must not wait on it.
    renderAt('/login');

    expect(screen.getByText('LOGIN PAGE')).toBeTruthy();
  });

  it('still bounces a known logged-in user away from /login', () => {
    vi.mocked(authApi.me).mockResolvedValue(me);

    renderAt('/login', me);

    expect(screen.queryByText('LOGIN PAGE')).toBeNull();
    expect(screen.getByText('HOME')).toBeTruthy();
  });
});

// V190: registration no longer asks for trades — the first screen inside does.
describe('auth gate — «Чим займаєтесь?» first for a master with no trade', () => {
  function renderWithWelcome(path: string, seedMe: UserResponse) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(ME_QUERY_KEY, seedMe);
    vi.mocked(authApi.me).mockResolvedValue(seedMe);
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/app" element={<ProtectedRoute><div>APP CONTENT</div></ProtectedRoute>} />
            <Route path="/welcome" element={<ProtectedRoute><div>WELCOME</div></ProtectedRoute>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }


  it('sends a master with no trade to /welcome, and /welcome itself does not loop', () => {
    renderWithWelcome('/app', aUser({ id: 'new', trades: [], customTrades: [] }));

    expect(screen.getByText('WELCOME')).toBeTruthy();
    expect(screen.queryByText('APP CONTENT')).toBeNull();
  });

  /** V193: the answer is the server's — a skip on another phone, or every trade unticked later. */
  it('lets him in once the server holds his answer, with no trade at all', () => {
    renderWithWelcome('/app', aUser({ id: 'new', trades: [], customTrades: [], tradesOnboardedAt: '2026-11-07T10:00:00Z' }));

    expect(screen.getByText('APP CONTENT')).toBeTruthy();
  });

  /** A reload restores `me` from the device, up to a second stale: a trade saved just before it
   *  must not bounce him back to «Чим займаєтесь?» while the server is still answering. */
  it('does not redirect on a restored, stale `me` while the fresh one is on its way', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(ME_QUERY_KEY, aUser({ id: 'new', trades: [], customTrades: [] }));
    void qc.invalidateQueries({ queryKey: ME_QUERY_KEY, refetchType: 'none' }); // what markRestoredStale does
    vi.mocked(authApi.me).mockResolvedValue(aUser({ id: 'new', trades: ['ELECTRICAL'] }));
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/app']}>
          <Routes>
            <Route path="/app" element={<ProtectedRoute><div>APP CONTENT</div></ProtectedRoute>} />
            <Route path="/welcome" element={<div>WELCOME</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.queryByText('WELCOME')).toBeNull();
    await waitFor(() => expect(authApi.me).toHaveBeenCalled());
    expect(await screen.findByText('APP CONTENT')).toBeTruthy();
    expect(screen.queryByText('WELCOME')).toBeNull();
  });

  it('never asks a master who has a trade, a custom one included', () => {
    renderWithWelcome('/app', aUser({ trades: [], customTrades: [{ id: 'c1', name: 'Стелі', sortOrder: 0 }] }));

    expect(screen.getByText('APP CONTENT')).toBeTruthy();
  });
});
