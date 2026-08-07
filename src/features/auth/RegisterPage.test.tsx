import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { RegisterPage } from './RegisterPage.tsx';
import { authApi } from '@/api/auth.ts';
import { routes } from '@/lib/config.ts';

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

describe('RegisterPage — custom trade', () => {
  function fillValidExceptTrade(container: HTMLElement) {
    fireEvent.change(container.querySelector('#email')!, { target: { value: 'a@b.com' } });
    fireEvent.change(container.querySelector('#password')!, { target: { value: 'Sup3rPass!' } });
    fireEvent.change(container.querySelector('#fullName')!, { target: { value: 'Іван' } });
    fireEvent.change(container.querySelector('#phone')!, { target: { value: '+380501112233' } });
    fireEvent.change(container.querySelector('#companyName')!, { target: { value: 'ФОП' } });
    fireEvent.click(container.querySelector('input[name="consent"]')!);
  }

  it('blocks submit when neither a system trade nor a custom trade is chosen', async () => {
    const { container } = renderPage();
    fillValidExceptTrade(container);

    fireEvent.click(screen.getByRole('button', { name: 'Створити акаунт' }));

    expect(await screen.findByText(/Оберіть хоча б один тип робіт/i)).toBeTruthy();
    expect(authApi.register).not.toHaveBeenCalled();
  });

  it('registers with only a custom trade and no system trade selected', async () => {
    vi.mocked(authApi.register).mockResolvedValue({
      accessToken: 'a', refreshToken: 'r', tokenType: 'Bearer', expiresInSeconds: 900,
      user: {} as never,
    } as never);

    const { container } = renderPage();
    fillValidExceptTrade(container);

    fireEvent.click(screen.getByText('+ Свій напрям'));
    fireEvent.change(screen.getByPlaceholderText('Напр. Натяжні стелі'), {
      target: { value: 'Натяжні стелі' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Додати' }));
    expect(screen.getByText(/Натяжні стелі/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Створити акаунт' }));

    await waitFor(() => expect(authApi.register).toHaveBeenCalled());
    expect(vi.mocked(authApi.register).mock.calls[0][0]).toMatchObject({
      trades: [],
      customTrades: ['Натяжні стелі'],
    });
  });

  it('removes a custom trade from the local list before submit', () => {
    renderPage();
    fireEvent.click(screen.getByText('+ Свій напрям'));
    fireEvent.change(screen.getByPlaceholderText('Напр. Натяжні стелі'), {
      target: { value: 'Стеля' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Додати' }));
    expect(screen.getByText(/Стеля/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Видалити' }));
    expect(screen.queryByText(/Стеля/)).toBeNull();
  });
});

describe('RegisterPage — duplicate email', () => {
  it('shows a "log in" shortcut (email prefilled) on a 409 EMAIL_ALREADY_REGISTERED', async () => {
    vi.mocked(authApi.register).mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { status: 409, message: 'taken', code: 'EMAIL_ALREADY_REGISTERED' } },
    });

    const { container } = renderPage();
    fillValid(container);
    fireEvent.click(container.querySelector('input[name="consent"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Створити акаунт' }));

    // The shortcut appears; clicking it goes to login with the email prefilled.
    const cta = await screen.findByRole('button', { name: /Увійти/ });
    fireEvent.click(cta);
    expect(navigateMock).toHaveBeenCalledWith(routes.login, { state: { email: 'a@b.com' } });
  });
});
