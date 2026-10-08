import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ActShareSheet } from './ActShareSheet.tsx';
import { actPortalApi } from '@/api/portal.ts';

vi.mock('@/api/portal.ts', () => ({
  actPortalApi: { publish: vi.fn(), sendEmail: vi.fn(), state: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// Publishing flips DRAFT→SENT, so the sheet invalidates the act it just changed (review P-50) —
// which needs a real client behind it.
// One client per test, like the app's single one: a client minted per render would itself change the
// effect's dependencies and hide whether the sheet re-publishes.
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('ActShareSheet', () => {
  it('publishes the act on open and shows the share link', async () => {
    vi.mocked(actPortalApi.publish).mockResolvedValue({ url: 'https://majstr.pro/portal/index.html?a=TOK', shared: true });

    render(<ActShareSheet actId="a1" open onClose={vi.fn()} />, { wrapper });

    await waitFor(() => expect(actPortalApi.publish).toHaveBeenCalledWith('a1'));
    // Honest wording — a confirmation of acceptance, not a legal-equivalence claim.
    expect(screen.getByText(/підтвердити приймання робіт/i)).toBeTruthy();
    expect(await screen.findByDisplayValue(/\?a=TOK/)).toBeTruthy();
  });

  // Review P-53: callers pass an inline `onClose`, and the publish invalidates the act, which
  // re-renders the parent — so a dependency on the callback published once per refetch, forever.
  it('publishes ONCE per opening, however often the parent re-renders', async () => {
    vi.mocked(actPortalApi.publish).mockResolvedValue({ url: 'https://majstr.pro/portal/index.html?a=TOK', shared: true });

    const { rerender } = render(<ActShareSheet actId="a1" open onClose={() => {}} />, { wrapper });
    await screen.findByDisplayValue(/\?a=TOK/);
    rerender(<ActShareSheet actId="a1" open onClose={() => {}} />);
    rerender(<ActShareSheet actId="a1" open onClose={() => {}} />);
    await screen.findByDisplayValue(/\?a=TOK/);

    expect(actPortalApi.publish).toHaveBeenCalledTimes(1);
  });

  it('does not publish while closed', () => {
    render(<ActShareSheet actId="a1" open={false} onClose={vi.fn()} />, { wrapper });
    expect(actPortalApi.publish).not.toHaveBeenCalled();
  });
});
