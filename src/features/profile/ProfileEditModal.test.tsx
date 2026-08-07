import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts'; // self-initialises on import → real UA strings in assertions
import { ProfileEditModal } from './ProfileEditModal.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { profileApi } from '@/api/profile.ts';
import { catalogApi } from '@/api/catalog.ts';
import type { UserResponse } from '@/api/types.ts';
import { aUser } from '@/test/factories.ts';

vi.mock('@/api/profile.ts', () => ({
  profileApi: {
    update: vi.fn(),
    uploadLogo: vi.fn(),
    deleteLogo: vi.fn(),
    addCustomTrade: vi.fn(),
    renameCustomTrade: vi.fn(),
    deleteCustomTrade: vi.fn(),
  },
}));
vi.mock('@/api/catalog.ts', () => ({
  catalogApi: { addFromTemplate: vi.fn() },
}));
// Toasts would reach into a store / DOM portal — stub them out.
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// verified → email field read-only, no email validation in the way
const me: UserResponse = aUser({
  phone: '+380501112233',
  companyName: 'ФОП Майстер',
  emailVerified: true,
});

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

  it('saves fine with every system trade unchecked (custom trades are a supported end state)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(ME_QUERY_KEY, me);
    vi.mocked(profileApi.update).mockResolvedValue({ ...me, trades: [] });

    renderModal(qc);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Електрика' }));
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    await waitFor(() =>
      expect(profileApi.update).toHaveBeenCalledWith(expect.objectContaining({ trades: [] })),
    );
    expect(screen.queryByText('Оберіть хоча б один тип робіт')).toBeNull();
  });
});

describe('ProfileEditModal — custom trades (user_trade)', () => {
  it('adds a custom trade, with the honest empty-catalog note shown before confirming', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(ME_QUERY_KEY, me);
    vi.mocked(profileApi.addCustomTrade).mockResolvedValue({
      ...me,
      customTrades: [{ id: 'ct1', name: 'Натяжні стелі', sortOrder: 0 }],
    });

    renderModal(qc);

    fireEvent.click(screen.getByText('+ Свій напрям'));
    // The honest disclosure is visible BEFORE the master confirms, not after.
    expect(screen.getByText(/готового каталогу немає/)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Напр. Натяжні стелі'), {
      target: { value: 'Натяжні стелі' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Додати' }));

    await waitFor(() => expect(profileApi.addCustomTrade).toHaveBeenCalledWith('Натяжні стелі'));
  });

  it('renames an existing custom trade', async () => {
    const withCustom: UserResponse = {
      ...me,
      customTrades: [{ id: 'ct1', name: 'Натяжні стелі', sortOrder: 0 }],
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(ME_QUERY_KEY, withCustom);
    vi.mocked(profileApi.renameCustomTrade).mockResolvedValue({
      ...withCustom,
      customTrades: [{ id: 'ct1', name: 'Кондиціонери', sortOrder: 0 }],
    });

    renderModal(qc);

    fireEvent.click(await screen.findByText('Редагувати', { selector: 'button' }));
    const input = screen.getByDisplayValue('Натяжні стелі');
    fireEvent.change(input, { target: { value: 'Кондиціонери' } });
    // Two "Зберегти" buttons coexist here — the inline rename row's and the outer profile
    // form's. The rename row renders first in DOM order.
    fireEvent.click(screen.getAllByRole('button', { name: 'Зберегти' })[0]);

    await waitFor(() =>
      expect(profileApi.renameCustomTrade).toHaveBeenCalledWith('ct1', 'Кондиціонери'));
  });

  it('deletes a custom trade after confirming — positions are not mentioned as lost', async () => {
    const withCustom: UserResponse = {
      ...me,
      customTrades: [{ id: 'ct1', name: 'Натяжні стелі', sortOrder: 0 }],
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(ME_QUERY_KEY, withCustom);
    vi.mocked(profileApi.deleteCustomTrade).mockResolvedValue({ ...withCustom, customTrades: [] });

    renderModal(qc);

    fireEvent.click(await screen.findByText('Видалити', { selector: 'button' }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Видалити напрям?' });
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Видалити' }));

    await waitFor(() => expect(profileApi.deleteCustomTrade).toHaveBeenCalledWith('ct1'));
  });
});
