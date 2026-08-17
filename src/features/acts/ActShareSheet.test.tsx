import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@/lib/i18n.ts';
import { ActShareSheet } from './ActShareSheet.tsx';
import { actPortalApi } from '@/api/portal.ts';

vi.mock('@/api/portal.ts', () => ({
  actPortalApi: { publish: vi.fn(), sendEmail: vi.fn(), state: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const wrapper = ({ children }: { children: ReactNode }) => <>{children}</>;

beforeEach(() => vi.clearAllMocks());

describe('ActShareSheet', () => {
  it('publishes the act on open and shows the share link', async () => {
    vi.mocked(actPortalApi.publish).mockResolvedValue({ url: 'https://majstr.pro/portal/index.html?a=TOK', shared: true });

    render(<ActShareSheet actId="a1" open onClose={vi.fn()} />, { wrapper });

    await waitFor(() => expect(actPortalApi.publish).toHaveBeenCalledWith('a1'));
    // Honest wording — a confirmation of acceptance, not a legal-equivalence claim.
    expect(screen.getByText(/підтвердити приймання робіт/i)).toBeTruthy();
    expect(await screen.findByDisplayValue(/\?a=TOK/)).toBeTruthy();
  });

  it('does not publish while closed', () => {
    render(<ActShareSheet actId="a1" open={false} onClose={vi.fn()} />, { wrapper });
    expect(actPortalApi.publish).not.toHaveBeenCalled();
  });
});
