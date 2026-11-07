import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts'; // self-initialises on import → real UA strings in assertions
import { ProfileEditModal } from './ProfileEditModal.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { profileApi } from '@/api/profile.ts';
import { toast } from '@/hooks/useToast.ts';
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

describe('ProfileEditModal — an added trade fills its catalog unasked (V190)', () => {
  /**
   * The modal used to ask «додати набір?» after a trade was added, and «Не зараз» left the trade's
   * bundles in the picker with every line at 0 ₴. The server now fills the starter catalog itself;
   * the modal saves, says so, and closes.
   */
  it('saves an added trade in one step, with no «Не зараз» question, and says what was added', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(ME_QUERY_KEY, me);
    vi.mocked(profileApi.update).mockResolvedValue({ ...me, trades: ['ELECTRICAL', 'PLUMBING'] });
    const onClose = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    render(<ProfileEditModal open onClose={onClose} />, { wrapper });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Сантехніка' }));
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(profileApi.update).toHaveBeenCalledWith(
      expect.objectContaining({ trades: ['ELECTRICAL', 'PLUMBING'] }),
    );
    expect(screen.queryByRole('button', { name: 'Не зараз' })).toBeNull();
    expect(toast.info).toHaveBeenCalledWith('Додали шаблони і позиції каталогу для: Сантехніка');
  });

  it('says nothing about templates when no trade was added (plain profile edit)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(ME_QUERY_KEY, me);
    vi.mocked(profileApi.update).mockResolvedValue(me); // same trades

    renderModal(qc);

    fireEvent.change(screen.getByDisplayValue('Іван Майстер'), {
      target: { value: 'Іван Петренко' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    await waitFor(() => expect(profileApi.update).toHaveBeenCalledOnce());
    expect(toast.info).not.toHaveBeenCalledWith(expect.stringContaining('Додали шаблони'));
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
  });
});

describe('ProfileEditModal — name, phone and company are optional (V190)', () => {
  it('saves with all three empty — a master who skipped them can still save his trades', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const bare = aUser({ fullName: undefined, phone: undefined, companyName: undefined, trades: [] });
    qc.setQueryData(ME_QUERY_KEY, bare);
    vi.mocked(profileApi.update).mockResolvedValue({ ...bare, trades: ['TILING'] });

    renderModal(qc);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Плитка' }));
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    await waitFor(() =>
      expect(profileApi.update).toHaveBeenCalledWith(
        expect.objectContaining({ fullName: '', phone: '', companyName: '', trades: ['TILING'] }),
      ),
    );
  });

  /** Review: once given, the name may change but not go — documents may already carry it. */
  it('refuses to erase a name that was already given', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(ME_QUERY_KEY, me);

    renderModal(qc);

    fireEvent.change(screen.getByDisplayValue('Іван Майстер'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    expect(await screen.findByText("Ім'я вже стоїть у ваших документах — його можна змінити, але не стерти")).toBeTruthy();
    expect(profileApi.update).not.toHaveBeenCalled();
  });

  it('still refuses a phone that was typed but is too short to be one', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(ME_QUERY_KEY, me);

    renderModal(qc);

    fireEvent.change(screen.getByDisplayValue('+380501112233'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    expect(await screen.findByText('Введіть телефон')).toBeTruthy();
    expect(profileApi.update).not.toHaveBeenCalled();
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
