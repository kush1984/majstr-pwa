import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { CashHomeStrip } from './CashHomeStrip.tsx';
import { cashApi } from '@/api/cash.ts';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('@/api/cash.ts', () => ({ cashApi: { summary: vi.fn() } }));

function renderStrip() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<CashHomeStrip />, { wrapper });
}

/**
 * The home screen already carries a greeting, trade chips, three metric tiles, the shopping card,
 * recent objects and quick actions. What this component must NOT do is add a sixth block to it —
 * hence a strip, and hence nothing at all in a week where nothing moved.
 */
describe('CashHomeStrip', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing in a week where nothing moved', async () => {
    vi.mocked(cashApi.summary).mockResolvedValue({
      from: '2026-09-07', to: '2026-09-13', income: 0, expense: 0, earned: 0, hasEntries: false,
    });

    const { container } = renderStrip();

    await waitFor(() => expect(cashApi.summary).toHaveBeenCalled());
    // A master who has never opened the feature sees no trace of it on his home screen.
    expect(container.textContent).toBe('');
  });

  it('shows both directions and opens the screen', async () => {
    vi.mocked(cashApi.summary).mockResolvedValue({
      from: '2026-09-07', to: '2026-09-13', income: 42000, expense: 18500, earned: 23500, hasEntries: true,
    });

    renderStrip();

    const strip = await screen.findByRole('button');
    expect(strip.textContent).toMatch(/42/);
    expect(strip.textContent).toMatch(/18/);

    fireEvent.click(strip);
    // It says where it came FROM, so «←» over there brings him back here and not to some other
    // door — the Профіль row passes its own origin the same way.
    expect(navigateMock).toHaveBeenCalledWith('/finance', { state: { from: '/' } });
  });
});
