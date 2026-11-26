import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { afterLoginPath } from './afterLogin.ts';
import { LoginPage } from './LoginPage.tsx';
import { ProtectedRoute, PublicOnlyRoute } from '@/routes/ProtectedRoute.tsx';
import { authApi } from '@/api/auth.ts';
import { tokens } from '@/lib/tokens.ts';
import { aUser } from '@/test/factories.ts';

vi.mock('@/api/auth.ts', () => ({ authApi: { login: vi.fn(), me: vi.fn() } }));
vi.mock('@/lib/sentry.ts', () => ({ setSentryUser: vi.fn() }));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  tokens.clear();
});

describe('afterLoginPath — where a sign-in lands', () => {
  it('the page he was going to, with its query', () => {
    expect(afterLoginPath({ from: '/estimates/e1' })).toBe('/estimates/e1');
    expect(afterLoginPath({ from: '/projects/p1?tab=money' })).toBe('/projects/p1?tab=money');
  });

  it('home for nothing, another site, or the login and register pages themselves', () => {
    expect(afterLoginPath(null)).toBe('/');
    expect(afterLoginPath({ from: 42 })).toBe('/');
    expect(afterLoginPath({ from: 'https://evil.example/x' })).toBe('/');
    expect(afterLoginPath({ from: '//evil.example/x' })).toBe('/');
    expect(afterLoginPath({ from: '/\\evil.example' })).toBe('/');
    expect(afterLoginPath({ from: '/login' })).toBe('/');
    expect(afterLoginPath({ from: '/register?ref=x' })).toBe('/');
  });
});

/** The bot's «Клієнт підписав кошторис» link, opened in a browser where he is not signed in. */
describe('a link from the bot, opened signed out', () => {
  it('goes through the login and lands on the estimate it names, not on home', async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      accessToken: 'a', refreshToken: 'r', tokenType: 'Bearer', expiresInSeconds: 900, user: aUser(),
    });
    vi.mocked(authApi.me).mockResolvedValue(aUser());
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/estimates/e1']}>
          <Routes>
            <Route path="/" element={<div>HOME</div>} />
            <Route path="/login" element={<PublicOnlyRoute><LoginPage /></PublicOnlyRoute>} />
            <Route path="/estimates/:id" element={<ProtectedRoute><div>ESTIMATE E1</div></ProtectedRoute>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'm@test.ua' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Увійти' }));

    expect(await screen.findByText('ESTIMATE E1')).toBeTruthy();
    expect(screen.queryByText('HOME')).toBeNull();
  });
});
