import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { ObjectEconomySection } from './ObjectEconomySection.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { economyApi } from '@/api/economy.ts';
import { estimatesApi } from '@/api/estimates.ts';
import { formatMoney } from '@/lib/format.ts';
import type { ObjectEconomyResponse, SignedEstimatePanelResponse, UserResponse } from '@/api/types.ts';

// Intl.NumberFormat('uk-UA') groups digits with U+00A0 (NBSP). RTL's default text normalizer
// collapses whitespace in the RENDERED node text before comparing, but does NOT touch a plain
// string matcher — so passing a raw `formatMoney(...)` result never matches. Normalize it here
// the same way RTL normalizes the DOM side (collapse any whitespace run to one ASCII space).
function money(n: number): string {
  return formatMoney(n).replace(/\s+/g, ' ');
}

vi.mock('@/api/economy.ts', () => ({
  economyApi: {
    economy: vi.fn(),
    listExpenses: vi.fn(),
    addExpense: vi.fn(),
    updateExpense: vi.fn(),
    deleteExpense: vi.fn(),
  },
}));
vi.mock('@/api/upgrade.ts', () => ({ upgradeApi: { click: vi.fn(() => Promise.resolve()) } }));
vi.mock('@/api/estimates.ts', () => ({ estimatesApi: { setCountInEconomy: vi.fn() } }));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function baseMe(plan: UserResponse['plan']): UserResponse {
  return {
    id: 'u1', email: 'm@e.com', fullName: 'M', trades: ['ELECTRICAL'], customTrades: [], phone: '1',
    companyName: 'C', logoUrl: null, plan, role: 'USER', emailVerified: true,
    createdAt: '2026-01-01', consentedToPrivacyAt: '2026-01-01', acknowledgedClientDataAt: '2026-01-01',
    planExpiresAt: null, autoRenew: false, cardMask: null, trialStartedAt: null, referralCode: 'refcode1',
  };
}

function panel(overrides: Partial<SignedEstimatePanelResponse> = {}): SignedEstimatePanelResponse {
  return {
    id: 'e1', name: 'Кухня', works: 10000, materials: 5000, markup: 0, discount: 0,
    total: 15000, countedInEconomy: true, signedAt: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

// PARTIAL (not RECEIVED) so the compact payments list shows "Аванс" directly as an upcoming row
// — a fully-RECEIVED-only fixture would collapse to the "Усе сплачено ✓" terminal state instead,
// which is what these tests are NOT exercising (they're checking FREE/PRO gating around the
// block, not its own collapse/expand behavior — that's covered in PaymentsBlock.test.tsx).
const SAMPLE_PAYMENTS: NonNullable<ObjectEconomyResponse['payments']> = {
  contractedTotal: 15000,
  received: 1500,
  remaining: 13500,
  payments: [
    {
      id: 'p1', amount: 3000, dueDate: null, nextStage: null, purpose: 'Аванс',
      received: 1500, remaining: 1500, status: 'PARTIAL', sortOrder: 0,
      receipts: [{ id: 'r1', planPaymentId: 'p1', label: null, displayLabel: 'Аванс', amount: 1500, receivedAt: '2026-07-01' }],
    },
  ],
  unplannedReceipts: [],
};

/** Mirrors the real backend: `payments`/`internals` are gated TOGETHER (economy-polish
 *  iteration) — both null, or both present. `estimates` is independent. */
function economyFixture(opts: {
  estimates?: SignedEstimatePanelResponse[];
  pro?: { expenses: number; profit: number } | null;
  payments?: NonNullable<ObjectEconomyResponse['payments']>;
} = {}): ObjectEconomyResponse {
  const pro = opts.pro ?? null;
  return {
    estimates: opts.estimates ?? [panel()],
    payments: pro ? (opts.payments ?? SAMPLE_PAYMENTS) : null,
    internals: pro,
  };
}

function renderSection(plan: UserResponse['plan']) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, baseMe(plan));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<ObjectEconomySection objectId="p1" />, { wrapper });
}

beforeEach(() => vi.clearAllMocks());

describe('ObjectEconomySection', () => {
  it('FREE: temporarily gets the full economy tab too — no lock teaser, summary + payments unlocked', async () => {
    // TEMPORARY business decision (TEMP_FREE_GETS_MEASUREMENTS_AND_ECONOMY): the backend now
    // returns real payments/internals for FREE too (Feature.OBJECT_ECONOMY granted to FREE in
    // PlanConfig), and the component's own isPro check is overridden the same way — so the
    // single lock teaser this used to show for FREE never renders.
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({ pro: { expenses: 3500, profit: 10500 } }));

    renderSection('FREE');

    await waitFor(() => expect(economyApi.economy).toHaveBeenCalledWith('p1'));
    expect(await screen.findByText('Кухня')).toBeTruthy(); // per-estimate panel
    expect(await screen.findByText('Загалом по підписаних')).toBeTruthy(); // summary panel
    expect(screen.getByText('Аванс')).toBeTruthy(); // payment row
    expect(screen.queryByText(/у PRO$/)).toBeNull(); // no lock teaser
  });

  it('PRO: shows the summary panel and payments, but Прибуток/Витрати stays parked', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({ pro: { expenses: 3500, profit: 10500 } }));

    renderSection('PRO');

    await waitFor(() => expect(economyApi.economy).toHaveBeenCalledWith('p1'));
    expect(await screen.findByText('Загалом по підписаних')).toBeTruthy(); // summary panel
    expect(screen.getByText('Аванс')).toBeTruthy(); // payment row
    // economy-hide-internals: parked behind INTERNALS_ENABLED — backend still sends `internals`
    // (used above to build the fixture), the component just doesn't render it.
    expect(screen.queryByText('Заробіток')).toBeNull();
    expect(screen.queryByText('Витрати')).toBeNull();
    expect(screen.queryByText('+ Витрата')).toBeNull();
    // Not fetched either — no point requesting a journal nobody sees.
    expect(economyApi.listExpenses).not.toHaveBeenCalled();
    // The teaser must NOT show for PRO.
    expect(screen.queryByText(/у PRO$/)).toBeNull();
  });

  it('economy-contracted-signed-only-fix: no SIGNED acts + no payments → neutral empty state, not 0/0/0', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({
      estimates: [],
      pro: { expenses: 0, profit: 0 },
      payments: { contractedTotal: 0, received: 0, remaining: 0, payments: [], unplannedReceipts: [] },
    }));

    renderSection('PRO');

    await waitFor(() => expect(economyApi.economy).toHaveBeenCalledWith('p1'));
    expect(await screen.findByText('Ще немає підписаних кошторисів')).toBeTruthy();
    // No summary panel (nothing counted) and no 0/0/0 payments card.
    expect(screen.queryByText('Загалом по підписаних')).toBeNull();
    expect(screen.queryByText('Платежі')).toBeNull(); // PaymentsBlock's own header
  });

  it('economy-contracted-signed-only-fix: manually-created payments still show even with no SIGNED acts', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({
      estimates: [],
      pro: { expenses: 0, profit: 0 },
      payments: { contractedTotal: 0, received: 0, remaining: 0, payments: [SAMPLE_PAYMENTS.payments[0]], unplannedReceipts: [] },
    }));

    renderSection('PRO');

    // The master already logged a payment by hand — show it as-is, not the empty state.
    expect(await screen.findByText('Аванс')).toBeTruthy();
    expect(screen.queryByText('Ще немає підписаних кошторисів')).toBeNull();
  });

  it('a panel excluded from the counted total says so honestly', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(
      economyFixture({ estimates: [panel({ countedInEconomy: false })] }),
    );

    renderSection('FREE');

    expect(await screen.findByText('Кухня')).toBeTruthy();
    expect(screen.getByText(/не враховано/i)).toBeTruthy();
  });

  it('clicking a panel navigates to the read-only estimate view', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture());

    renderSection('FREE');

    fireEvent.click(await screen.findByText('Кухня'));
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('e1'));
  });

  it('the act card shows a discount/markup recap with a derived percent', async () => {
    // works/materials are gross (pre-adjustment) — base = works 8000 + materials 2000 = 10000;
    // 1500/10000 = 15%. total = works + materials + markup + discount = 8000+2000+0-1500 = 8500.
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({
      estimates: [panel({ works: 8000, materials: 2000, markup: 0, discount: -1500, total: 8500 })],
    }));

    renderSection('FREE');

    expect(await screen.findByText(/Знижка\s+15%\s+-1\s500/)).toBeTruthy();
  });

  it('the act ⋮ menu toggles counted-in-economy via the existing PATCH', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(
      economyFixture({ estimates: [panel({ countedInEconomy: true })] }),
    );
    vi.mocked(estimatesApi.setCountInEconomy).mockResolvedValue({} as never);

    renderSection('FREE');

    await screen.findByText('Кухня');
    fireEvent.click(screen.getByLabelText('Дії'));
    fireEvent.click(await screen.findByText('Не враховувати цей акт'));

    await waitFor(() => expect(estimatesApi.setCountInEconomy).toHaveBeenCalledWith('e1', false));
  });

  it('the summary panel sums only COUNTED signed estimates, with a markup/discount recap', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({
      pro: { expenses: 0, profit: 0 },
      estimates: [
        panel({ id: 'e1', name: 'Кухня', works: 10000, materials: 5000, markup: 1000, discount: 0, total: 15000, countedInEconomy: true }),
        panel({ id: 'e2', name: 'Ванна', works: 4000, materials: 1000, markup: 0, discount: -500, total: 5000, countedInEconomy: false }),
      ],
    }));

    renderSection('PRO');

    const heading = await screen.findByText('Загалом по підписаних');
    const summary = heading.closest('div') as HTMLElement;
    // Only e1 counts: works 10000, materials 5000, markup 1000 shown, discount from e2 excluded.
    expect(within(summary).getByText(money(10000))).toBeTruthy();
    expect(within(summary).getByText(`Надбавка +${money(1000)}`)).toBeTruthy();
    expect(within(summary).queryByText(/Знижка/)).toBeNull();
  });

  it('no summary panel when nothing is counted (even on PRO)', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({
      pro: { expenses: 0, profit: 0 },
      estimates: [panel({ countedInEconomy: false })],
    }));

    renderSection('PRO');

    await screen.findByText('Кухня');
    expect(screen.queryByText('Загалом по підписаних')).toBeNull();
  });
});
