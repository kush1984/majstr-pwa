import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { RegionAskCard } from './RegionAskCard.tsx';
import { regionOptions } from './regionOptions.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { profileApi } from '@/api/profile.ts';
import { aUser } from '@/test/factories.ts';
import { tokens } from '@/lib/tokens.ts';
import i18n from '@/lib/i18n.ts';
import type { UserResponse } from '@/api/types.ts';

/** «У якій області працюєте?» (V219): asked until answered, saved on its own, «Пізніше» snoozes it. */
vi.mock('@/api/profile.ts', () => ({ profileApi: { updateRegion: vi.fn() } }));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

function renderCard(me: UserResponse) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, me);
  return render(<QueryClientProvider client={qc}><RegionAskCard /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(tokens, 'hasAny').mockReturnValue(false);
  localStorage.clear();
});

describe('RegionAskCard', () => {
  it('asks a master with no region, and saves the one he picks', async () => {
    const me = aUser({ id: 'u-reg', region: null });
    vi.mocked(profileApi.updateRegion).mockResolvedValue({ ...me, region: 'LVIV' });
    renderCard(me);

    fireEvent.change(screen.getByRole('combobox', { name: 'Область, де працюєте' }), { target: { value: 'LVIV' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    await waitFor(() => expect(profileApi.updateRegion).toHaveBeenCalledWith('LVIV'));
    await waitFor(() => expect(screen.queryByText('У якій області працюєте?')).toBeNull());
  });

  it('never asks a master who has answered', () => {
    const { container } = renderCard(aUser({ region: 'KYIV_CITY' }));
    expect(container.textContent).toBe('');
  });

  it('«Пізніше» puts it away on this device', () => {
    renderCard(aUser({ id: 'u-later', region: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Пізніше' }));

    expect(screen.queryByText('У якій області працюєте?')).toBeNull();
    expect(localStorage.getItem('majstr.regionAskSnoozedAt.u-later')).not.toBeNull();
  });
});

describe('regionOptions', () => {
  it('lists all 25 regions, Kyiv city first, then the oblasts alphabetically', () => {
    const options = regionOptions(i18n.t.bind(i18n));
    expect(options).toHaveLength(25);
    expect(options[0].label).toBe('м. Київ');
    expect(options[1].label).toBe('Вінницька');
    expect(options.at(-1)?.label).toBe('Чернігівська');
  });
});
