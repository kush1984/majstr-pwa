import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/lib/i18n.ts';
import { ResetPasswordPage } from './ResetPasswordPage.tsx';
import { authApi } from '@/api/auth.ts';

vi.mock('@/api/auth.ts', () => ({ authApi: { resetPassword: vi.fn() } }));

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

function renderAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <ResetPasswordPage />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('ResetPasswordPage', () => {
  it('sets a new password with the token from the query and redirects to login', async () => {
    vi.mocked(authApi.resetPassword).mockResolvedValue(undefined);
    renderAt('/reset-password?token=abc123');

    fireEvent.change(screen.getByLabelText('Новий пароль'), { target: { value: 'newPass123' } });
    fireEvent.change(screen.getByLabelText('Повторіть пароль'), { target: { value: 'newPass123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Змінити пароль' }));

    await waitFor(() => expect(authApi.resetPassword).toHaveBeenCalledWith('abc123', 'newPass123'));
    expect(navigate).toHaveBeenCalledWith('/login', expect.objectContaining({ replace: true }));
  });

  it('blocks submit until the two passwords match', async () => {
    renderAt('/reset-password?token=abc123');
    fireEvent.change(screen.getByLabelText('Новий пароль'), { target: { value: 'newPass123' } });
    fireEvent.change(screen.getByLabelText('Повторіть пароль'), { target: { value: 'different1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Змінити пароль' }));
    await waitFor(() => expect(screen.getByText(/Паролі не збігаються/)).toBeTruthy());
    expect(authApi.resetPassword).not.toHaveBeenCalled();
  });

  it('shows the expired screen with no token in the URL', () => {
    renderAt('/reset-password');
    expect(screen.getByText('Посилання застаріло')).toBeTruthy();
  });

  it('shows the expired screen when the backend rejects the token (400)', async () => {
    vi.mocked(authApi.resetPassword).mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 400,
        data: { message: 'Посилання застаріло', status: 400, code: 'INVALID_OR_EXPIRED_TOKEN' },
      },
    });
    renderAt('/reset-password?token=stale');
    fireEvent.change(screen.getByLabelText('Новий пароль'), { target: { value: 'newPass123' } });
    fireEvent.change(screen.getByLabelText('Повторіть пароль'), { target: { value: 'newPass123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Змінити пароль' }));
    await waitFor(() => expect(screen.getByText('Посилання застаріло')).toBeTruthy());
  });
});
