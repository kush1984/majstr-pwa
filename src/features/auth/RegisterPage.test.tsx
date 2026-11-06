import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { RegisterPage } from './RegisterPage.tsx';
import { authApi } from '@/api/auth.ts';
import { routes } from '@/lib/config.ts';
import { sendVisit } from '@/lib/visit.ts';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('@/api/auth.ts', () => ({ authApi: { register: vi.fn() } }));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/visit.ts', () => ({ sendVisit: vi.fn() }));

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

describe('RegisterPage — the visit funnel', () => {
  it('says once that the form was started, and never what was typed', () => {
    const { container } = renderPage();

    fireEvent.input(container.querySelector('#email')!, { target: { value: 'a@b.com' } });
    fireEvent.input(container.querySelector('#fullName')!, { target: { value: 'Іван' } });

    expect(sendVisit).toHaveBeenCalledOnce();
    expect(sendVisit).toHaveBeenCalledWith('REGISTER_STARTED', routes.register);
  });

  it('says how far down the form the visitor got, each field once', () => {
    const { container } = renderPage();

    container.querySelector<HTMLInputElement>('#email')!.focus();
    container.querySelector<HTMLInputElement>('#password')!.focus();
    container.querySelector<HTMLInputElement>('#email')!.focus();

    expect(vi.mocked(sendVisit).mock.calls).toEqual([
      ['REGISTER_FIELD', routes.register, { target: 'email' }],
      ['REGISTER_FIELD', routes.register, { target: 'password' }],
    ]);
  });

  it("names the field the form's own check stopped on", async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Створити акаунт' }));

    await waitFor(() =>
      expect(sendVisit).toHaveBeenCalledWith('REGISTER_ERROR', routes.register, { target: 'field:email' }),
    );
    expect(sendVisit).not.toHaveBeenCalledWith('REGISTER_SUBMIT', routes.register);
    // The form focuses the failed field itself; that is not the visitor reaching it.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sendVisit).not.toHaveBeenCalledWith('REGISTER_FIELD', routes.register, { target: 'email' });
  });

  it('says a valid form was sent, and which server error came back', async () => {
    vi.mocked(authApi.register).mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { status: 409, message: 'taken', code: 'EMAIL_ALREADY_REGISTERED' } },
    });
    const { container } = renderPage();
    fillValid(container);
    fireEvent.click(container.querySelector('input[name="consent"]')!);

    fireEvent.click(screen.getByRole('button', { name: 'Створити акаунт' }));

    await waitFor(() =>
      expect(sendVisit).toHaveBeenCalledWith('REGISTER_ERROR', routes.register, {
        target: 'server:email_already_registered',
      }),
    );
    expect(sendVisit).toHaveBeenCalledWith('REGISTER_SUBMIT', routes.register);
  });
});

describe('RegisterPage — a refused email is seen, not pressed into the rate limit', () => {
  it('offers the domain it most likely meant when the field is left, and takes it in one tap', async () => {
    const { container } = renderPage();
    const email = container.querySelector<HTMLInputElement>('#email')!;

    fireEvent.change(email, { target: { value: 'ivan@gmal.com' } });
    fireEvent.blur(email);
    fireEvent.click(await screen.findByRole('button', { name: 'Може, ivan@gmail.com?' }));

    await waitFor(() => expect(email.value).toBe('ivan@gmail.com'));
    expect(screen.queryByRole('button', { name: /Може,/ })).toBeNull();
  });

  it('suggests nothing for an address that is fine', () => {
    const { container } = renderPage();
    const email = container.querySelector<HTMLInputElement>('#email')!;

    fireEvent.change(email, { target: { value: 'ivan@ukr.net' } });
    fireEvent.blur(email);

    expect(screen.queryByRole('button', { name: /Може,/ })).toBeNull();
  });

  it('scrolls to the field and focuses it when the server refuses the address', async () => {
    vi.mocked(authApi.register).mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { status: 400, message: 'Схоже, в адресі помилка.', code: 'EMAIL_NO_MAIL' } },
    });
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { container } = renderPage();
    fillValid(container);
    fireEvent.change(container.querySelector('#email')!, { target: { value: 'ivan@gmal.com' } });
    fireEvent.click(container.querySelector('input[name="consent"]')!);

    fireEvent.click(screen.getByRole('button', { name: 'Створити акаунт' }));

    expect(await screen.findByText('Схоже, в адресі помилка.')).toBeTruthy();
    expect(document.activeElement).toBe(container.querySelector('#email'));
    expect(scroll).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Може, ivan@gmail.com?' })).toBeTruthy();
    expect(sendVisit).toHaveBeenCalledWith('REGISTER_ERROR', routes.register, { target: 'server:email_no_mail' });
    scroll.mockRestore();
  });
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

describe('RegisterPage — the company name follows the name (review P1-16)', () => {
  it('copies the full name into «Назва компанії» until the master types his own', () => {
    const { container } = renderPage();
    const fullName = container.querySelector('#fullName')!;
    const company = container.querySelector<HTMLInputElement>('#companyName')!;

    fireEvent.change(fullName, { target: { value: 'Іван Петренко' } });
    expect(company.value).toBe('Іван Петренко');

    fireEvent.change(company, { target: { value: 'ФОП Петренко' } });
    fireEvent.change(fullName, { target: { value: 'Іван Петренко-Мельник' } });
    expect(company.value).toBe('ФОП Петренко');
  });
});

describe('RegisterPage — a draft survives a reload, the password never does (review P1-2)', () => {
  it('restores the typed fields and leaves the password empty', () => {
    const first = renderPage();
    fireEvent.change(first.container.querySelector('#fullName')!, { target: { value: 'Іван Петренко' } });
    fireEvent.change(first.container.querySelector('#password')!, { target: { value: 'secret-pass-1' } });
    first.unmount();

    expect(sessionStorage.getItem('majstr.draft.register')).not.toContain('secret-pass-1');
    const again = renderPage();
    expect(again.container.querySelector('#fullName')).toHaveProperty('value', 'Іван Петренко');
    expect(again.container.querySelector('#password')).toHaveProperty('value', '');
  });
});
