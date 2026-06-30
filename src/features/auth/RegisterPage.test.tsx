import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { RegisterPage } from './RegisterPage.tsx';
import { authApi } from '@/api/auth.ts';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('@/api/auth.ts', () => ({ authApi: { register: vi.fn() } }));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<RegisterPage />, { wrapper });
}

function fillValid(container: HTMLElement) {
  fireEvent.change(container.querySelector('#email')!, { target: { value: 'a@b.com' } });
  fireEvent.change(container.querySelector('#password')!, { target: { value: 'Sup3rPass!' } });
  fireEvent.change(container.querySelector('#fullName')!, { target: { value: 'Іван' } });
  fireEvent.click(container.querySelector('input[value="ELECTRICAL"]')!);
  fireEvent.change(container.querySelector('#phone')!, { target: { value: '+380501112233' } });
  fireEvent.change(container.querySelector('#companyName')!, { target: { value: 'ФОП' } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RegisterPage — privacy consent', () => {
  it('blocks submit until the consent box is ticked', async () => {
    const { container } = renderPage();
    fillValid(container);

    // Submit without consent → validation blocks, register is not called.
    fireEvent.click(screen.getByRole('button', { name: 'Створити акаунт' }));
    expect(await screen.findByText(/погодитися з Політикою/i)).toBeTruthy();
    expect(authApi.register).not.toHaveBeenCalled();
  });

  it('registers with consent:true once ticked', async () => {
    vi.mocked(authApi.register).mockResolvedValue({
      accessToken: 'a', refreshToken: 'r', tokenType: 'Bearer', expiresInSeconds: 900,
      user: {} as never,
    } as never);

    const { container } = renderPage();
    fillValid(container);
    fireEvent.click(container.querySelector('input[name="consent"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Створити акаунт' }));

    await waitFor(() => expect(authApi.register).toHaveBeenCalled());
    expect(vi.mocked(authApi.register).mock.calls[0][0]).toMatchObject({ consent: true });
  });
});
