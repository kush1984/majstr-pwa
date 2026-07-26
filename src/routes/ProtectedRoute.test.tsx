import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
