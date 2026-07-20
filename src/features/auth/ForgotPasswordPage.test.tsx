import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/lib/i18n.ts';
import { ForgotPasswordPage } from './ForgotPasswordPage.tsx';
import { authApi } from '@/api/auth.ts';

vi.mock('@/api/auth.ts', () => ({ authApi: { forgotPassword: vi.fn() } }));

function renderPage() {
  render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('ForgotPasswordPage', () => {
  it('submits the email and shows the neutral check-your-email screen', async () => {
    vi.mocked(authApi.forgotPassword).mockResolvedValue(undefined);
    renderPage();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати посилання' }));

    await waitFor(() => expect(screen.getByText('Перевірте пошту')).toBeTruthy());
    expect(authApi.forgotPassword).toHaveBeenCalledWith('a@b.com');
  });

  it('shows the SAME neutral screen regardless of whether the account exists', async () => {
    // The backend answers a neutral 200 either way; the page can't and must not branch on it.
    vi.mocked(authApi.forgotPassword).mockResolvedValue(undefined);
    renderPage();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ghost@nowhere.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати посилання' }));
    await waitFor(() => expect(screen.getByText('Перевірте пошту')).toBeTruthy());
  });

  it('validates the email before calling the API', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати посилання' }));
    await waitFor(() => expect(screen.getByText(/Невірний формат email/)).toBeTruthy());
    expect(authApi.forgotPassword).not.toHaveBeenCalled();
  });
});
