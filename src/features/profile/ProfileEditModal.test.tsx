import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts'; // self-initialises on import → real UA strings in assertions
import { ProfileEditModal } from './ProfileEditModal.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { profileApi } from '@/api/profile.ts';
import { catalogApi } from '@/api/catalog.ts';
import type { UserResponse } from '@/api/types.ts';

vi.mock('@/api/profile.ts', () => ({
  profileApi: { update: vi.fn(), uploadLogo: vi.fn(), deleteLogo: vi.fn() },
}));
vi.mock('@/api/catalog.ts', () => ({
  catalogApi: { addFromTemplate: vi.fn() },
}));
// Toasts would reach into a store / DOM portal — stub them out.
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const me: UserResponse = {
  id: 'u1',
  email: 'master@example.com',
  fullName: 'Іван Майстер',
  trades: ['ELECTRICAL'],
  phone: '+380501112233',
  companyName: 'ФОП Майстер',
  logoUrl: null,
  plan: 'FREE',
  role: 'USER',
  emailVerified: true, // verified → email field read-only, no email validation in the way
  createdAt: '2026-01-01T00:00:00Z',
};

function renderModal(qc: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<ProfileEditModal open onClose={() => {}} />, { wrapper });
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('ProfileEditModal — add-trade starter-set prompt', () => {
  /**
   * Regression for the bug where adding a trade never offered its starter set:
   * `useUpdateProfile` primes + invalidates the `['me']` cache, so `me` changes
   * the instant the save resolves. Without the `seededRef` guard the modal's
   * seed effect re-fired and called `setAddPrompt(null)`, wiping the prompt
   * before it rendered. This test drives the real save → me-change flow and
   * asserts the prompt SURVIVES.
   */
  it('shows the "add starter set?" prompt after adding a trade and saving', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(ME_QUERY_KEY, me);
    // The save resolves with the user now carrying the added trade — this is what
    // flips the `['me']` cache and used to wipe the prompt.
    vi.mocked(profileApi.update).mockResolvedValue({ ...me, trades: ['ELECTRICAL', 'PLUMBING'] });

    renderModal(qc);

    // Add PLUMBING ("Сантехніка") and save.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Сантехніка' }));
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    // The prompt appears AND stays — its "Не зараз" button only exists in prompt
    // mode, and the edit form's "Зберегти" is gone (we didn't revert to the form).
    expect(await screen.findByRole('button', { name: 'Не зараз' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Зберегти' })).toBeNull();
    expect(profileApi.update).toHaveBeenCalledOnce();
  });

  it('merges the added trade\'s starter set when the prompt is confirmed', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(ME_QUERY_KEY, me);
    vi.mocked(profileApi.update).mockResolvedValue({ ...me, trades: ['ELECTRICAL', 'PLUMBING'] });
    vi.mocked(catalogApi.addFromTemplate).mockResolvedValue({ itemsAdded: 7 });

    renderModal(qc);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Сантехніка' }));
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Додати' }));

    // Only the newly-added trade is sent to the merge endpoint.
    await waitFor(() =>
      expect(catalogApi.addFromTemplate).toHaveBeenCalledWith(['PLUMBING']),
    );
  });

  it('does not prompt when no trade was added (plain profile edit)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(ME_QUERY_KEY, me);
    vi.mocked(profileApi.update).mockResolvedValue(me); // same trades

    renderModal(qc);

    fireEvent.change(screen.getByDisplayValue('Іван Майстер'), {
      target: { value: 'Іван Петренко' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    await waitFor(() => expect(profileApi.update).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: 'Не зараз' })).toBeNull();
    expect(catalogApi.addFromTemplate).not.toHaveBeenCalled();
  });
});
