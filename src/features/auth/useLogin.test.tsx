import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLogin } from './useLogin.ts';
import { ME_QUERY_KEY } from './useMe.ts';
import { authApi } from '@/api/auth.ts';
import { tokens } from '@/lib/tokens.ts';
import type { AuthResponse, UserResponse } from '@/api/types.ts';

vi.mock('@/api/auth.ts', () => ({ authApi: { login: vi.fn() } }));
vi.mock('@/lib/sentry.ts', () => ({ setSentryUser: vi.fn() }));

const CATALOG_KEY = ['catalog', 'list', 'all'] as const;

function userB(): UserResponse {
  return {
    id: 'user-b',
    email: 'b@example.com',
    fullName: 'Майстер Б',
    trades: ['PLUMBING'],
    phone: '+380000000002',
    companyName: 'Б',
    logoUrl: null,
    plan: 'FREE',
    role: 'USER',
    emailVerified: true,
    createdAt: '2026-06-12T00:00:00Z',
  };
}

function authResponse(user: UserResponse): AuthResponse {
  return {
    accessToken: 'access-b',
    refreshToken: 'refresh-b',
    tokenType: 'Bearer',
    expiresInSeconds: 900,
    user,
  };
}

function renderUseLogin(qc: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useLogin(), { wrapper });
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('useLogin tenant isolation', () => {
  it('clears the previous account cache on login so it cannot bleed to the new user', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Master A's warm, NOT user-scoped catalog cache from a prior session.
    qc.setQueryData(CATALOG_KEY, [{ id: 'a-item', name: "Позиція майстра А" }]);
    vi.mocked(authApi.login).mockResolvedValue(authResponse(userB()));

    const { result } = renderUseLogin(qc);
    await result.current.mutateAsync({ email: 'b@example.com', password: 'secret123' });

    // Master A's catalog is gone — B will fetch his own.
    expect(qc.getQueryData(CATALOG_KEY)).toBeUndefined();
    // B's /me is primed for an instant dashboard.
    expect(qc.getQueryData(ME_QUERY_KEY)).toEqual(userB());
  });

  it('stores the new token pair', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(authApi.login).mockResolvedValue(authResponse(userB()));

    const { result } = renderUseLogin(qc);
    await result.current.mutateAsync({ email: 'b@example.com', password: 'secret123' });

    expect(tokens.getAccess()).toBe('access-b');
    expect(tokens.getRefresh()).toBe('refresh-b');
  });
});
