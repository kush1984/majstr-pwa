import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';

const cfg = vi.hoisted(() => ({ googleClientId: 'client-1' }));
vi.mock('@/lib/config.ts', async (orig) => {
  const real = await orig<typeof import('@/lib/config.ts')>();
  return { ...real, config: new Proxy(real.config, { get: (t, k) => (k === 'googleClientId' ? cfg.googleClientId : t[k as keyof typeof t]) }) };
});
vi.mock('@/api/auth.ts', () => ({ authApi: { google: vi.fn() } }));
vi.mock('./startSession.ts', () => ({ startSession: vi.fn(() => Promise.resolve()) }));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { GoogleSignIn } from './GoogleSignIn.tsx';
import { authApi } from '@/api/auth.ts';
import { startSession } from './startSession.ts';
import { toast } from '@/hooks/useToast.ts';

type Callback = (r: { credential: string }) => void;
let callback: Callback | null = null;

function renderIt() {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
  );
  return render(<GoogleSignIn />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  cfg.googleClientId = 'client-1';
  callback = null;
  // Google's script, as far as this component can tell: it loads and exposes accounts.id.
  vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
    (window as unknown as { google: unknown }).google = {
      accounts: { id: {
        initialize: (o: { callback: Callback }) => { callback = o.callback; },
        renderButton: (el: HTMLElement) => { el.textContent = 'Google'; },
      } },
    };
    queueMicrotask(() => (node as HTMLScriptElement).onload?.(new Event('load')));
    return node;
  });
});

describe('GoogleSignIn', () => {
  it('signs in with the credential Google hands back and starts the session', async () => {
    vi.mocked(authApi.google).mockResolvedValue({ accessToken: 'a' } as never);
    renderIt();

    await waitFor(() => expect(callback).not.toBeNull());
    expect(screen.getByText(/Продовжуючи з Google/)).toBeTruthy();
    callback?.({ credential: 'google-id-token' });

    await waitFor(() => expect(startSession).toHaveBeenCalled());
    expect(vi.mocked(authApi.google).mock.calls[0][0]).toMatchObject({ credential: 'google-id-token' });
  });

  it('a refused Google token says Google, not «wrong email or password»', async () => {
    vi.mocked(authApi.google).mockRejectedValue({
      isAxiosError: true,
      response: { status: 401, data: { status: 401, message: 'Невірний email або пароль' } },
    });
    renderIt();
    await waitFor(() => expect(callback).not.toBeNull());

    callback?.({ credential: 'google-id-token' });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Не вдалося увійти через Google. Спробуйте ще раз або увійдіть поштою.'));
  });

  it('draws nothing without a client id, so the email form stands alone', () => {
    cfg.googleClientId = '';
    const { container } = renderIt();

    expect(container.innerHTML).toBe('');
  });
});
