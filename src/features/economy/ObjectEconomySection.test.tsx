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
import { actsApi } from '@/api/acts.ts';
import { formatMoney, formatMoneyExact } from '@/lib/format.ts';
import type { ObjectEconomyResponse, SignedEstimatePanelResponse, UserResponse, WorkActResponse } from '@/api/types.ts';

// Intl.NumberFormat('uk-UA') groups digits with U+00A0 (NBSP). RTL's default text normalizer
// collapses whitespace in the RENDERED node text before comparing, but does NOT touch a plain
// string matcher — so passing a raw `formatMoney(...)` result never matches. Normalize it here
// the same way RTL normalizes the DOM side (collapse any whitespace run to one ASCII space).
function money(n: number): string {
  return formatMoney(n).replace(/\s+/g, ' ');
}

/** The materials axis prints kopecks — a receipt is a paper sum, not a rounded one. */
function moneyExact(n: number): string {
  return formatMoneyExact(n).replace(/\s+/g, ' ');
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
vi.mock('@/api/acts.ts', () => ({ actsApi: { list: vi.fn(() => Promise.resolve([])), create: vi.fn() } }));
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
    legalName: null, taxId: null, legalAddress: null, iban: null, bankName: null, vatPayer: false,
    vatId: null, taxGroup: null, taxRate: null, docCity: null, actNumberFormat: 'PLAIN',
  };
}

/** The payments card, addressed through its own heading — the section holds several cards and
 *  «· 0 %» is a legitimate reading in the acts and materials axes above it. */
function paymentsCard(heading: HTMLElement): HTMLElement {
  const card = heading.closest('section');
  if (!card) throw new Error('payments heading is not inside a <section>');
  return card;
}

function panel(overrides: Partial<SignedEstimatePanelResponse> = {}): SignedEstimatePanelResponse {
  return {
    id: 'e1', name: 'Кухня', works: 10000, materials: 5000, markup: 0, discount: 0,
    total: 15000, countedInEconomy: true, signedAt: '2026-07-01T00:00:00Z', kind: 'REGULAR' as const,
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
  materialRefunds: 0,
  refundApplied: 0,
  workPaid: 1500,
  overpaid: 0,
  payments: [
    {
      id: 'p1', amount: 3000, dueDate: null, nextStage: null, purpose: 'Аванс',
      received: 1500, remaining: 1500, status: 'PARTIAL', sortOrder: 0,
      receipts: [{ id: 'r1', planPaymentId: 'p1', label: null, displayLabel: 'Аванс', amount: 1500, receivedAt: '2026-07-01', materialRefund: false }],
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
  acts?: ObjectEconomyResponse['acts'];
  materials?: ObjectEconomyResponse['materials'];
} = {}): ObjectEconomyResponse {
  const pro = opts.pro ?? null;
  return {
    estimates: opts.estimates ?? [panel()],
    acts: opts.acts ?? { contracted: 15000, acceptedByActs: 0, received: 1500 },
    // Nothing bought by default: the materials card is absent until a receipt exists, so every
    // pre-V129 assertion in this file keeps seeing exactly the screen it was written against.
    materials: opts.materials ?? { reimbursable: 0, refundApplied: 0, outstanding: 0, receiptCount: 0, unpricedCount: 0 },
    payments: pro ? (opts.payments ?? SAMPLE_PAYMENTS) : null,
    internals: pro,
  };
}

function openAct(): WorkActResponse {
  return {
    id: 'a1', projectId: 'p1', number: '1', title: null, kind: 'INTERIM', status: 'DRAFT',
    issuedAt: '2026-08-10', periodFrom: '2026-08-01', periodTo: '2026-08-10',
    place: null, contractRef: null, note: null, showMaterials: true, showCumulative: true,
    receiptsToExpenses: true, showReceiptPhotos: true, advanceOffset: null, retentionPercent: null, sentAt: null, signedAt: null,
    signerName: null, signedOffline: false, addendumEstimateId: null, items: [], receipts: [],
    total: 0, receiptsTotal: 0, payable: 0, createdAt: '2026-08-10', updatedAt: '2026-08-10',
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

  it('PRO: shows the summary panel and payments, and «Заробіток» is gone for good', async () => {
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

  /**
   * The percent beside the amount is the one the master TYPED, not one derived from the wrong
   * base. «Знижка 15 %» on works of 31 829 ₴ used to print as «14,776%», because the client
   * divided 4 774 by works+materials while the line is measured against works alone.
   */
  it('prints the discount percent the master typed, not one derived from the wrong base', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({
      estimates: [panel({
        works: 31829, materials: 483, discount: -4774, markup: 0,
        discountRate: -15, total: 27538,
      })],
      pro: { expenses: 0, profit: 0 },
    }));

    renderSection('PRO');

    expect(await screen.findByText(/Знижка 15/)).toBeTruthy();
    expect(screen.queryByText(/14,77/)).toBeNull();
  });

  /** Several «% від кошторису» lines at different percents: the amount alone, never a blend. */
  it('shows the amount alone when the server sends no rate', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({
      estimates: [panel({ works: 31829, materials: 483, discount: -4774, markup: 0, total: 27538 })],
      pro: { expenses: 0, profit: 0 },
    }));

    renderSection('PRO');

    // The panel and the «Загалом по підписаних» summary both render a recap line; neither may
    // invent a percent.
    const lines = await screen.findAllByText(/Знижка/);
    expect(lines).not.toHaveLength(0);
    lines.forEach((line) => expect(line.textContent).not.toMatch(/%/));
  });

  it('a marked-up copy shows «Бригаді / Твоя націнка», and it is not a profit figure', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({
      estimates: [panel({
        crewMargin: { crewTotal: 20000, margin: 4000, marginAccepted: 0, unpricedCount: 0, unpricedTotal: 0 },
      })],
      pro: { expenses: 0, profit: 0 },
    }));

    renderSection('PRO');

    expect(await screen.findByText('Бригаді')).toBeTruthy();
    expect(screen.getByText('Твоя націнка')).toBeTruthy();
    // The caption is the whole point: it is a difference between two prices, not an earning.
    expect(screen.getByText(/Матеріали, пальне й інше сюди не входять/)).toBeTruthy();
    // Nothing accepted yet — the act line stays off rather than showing a zero.
    expect(screen.queryByText('з прийнятого актами')).toBeNull();
  });

  it('names the lines that carry no crew price instead of inflating the margin', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({
      estimates: [panel({
        crewMargin: { crewTotal: 20000, margin: 4000, marginAccepted: 1600, unpricedCount: 2, unpricedTotal: 5000 },
      })],
      pro: { expenses: 0, profit: 0 },
    }));

    renderSection('PRO');

    expect(await screen.findByText('з прийнятого актами')).toBeTruthy();
    expect(screen.getByText(/додано без ціни бригади/)).toBeTruthy();
  });

  it('an ordinary estimate shows no crew figures at all', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(
      economyFixture({ estimates: [panel()], pro: { expenses: 0, profit: 0 } }));

    renderSection('PRO');

    await screen.findByText('Загалом по підписаних');
    expect(screen.queryByText('Бригаді')).toBeNull();
    expect(screen.queryByText('Твоя націнка')).toBeNull();
  });

  it('nothing signed yet: the block stands down its zero figures but KEEPS «+ Платіж» — an advance comes first', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({
      estimates: [],
      pro: { expenses: 0, profit: 0 },
      payments: {
        contractedTotal: 0, received: 0, remaining: 0, materialRefunds: 0, refundApplied: 0,
        workPaid: 0, overpaid: 0, payments: [], unplannedReceipts: [],
      },
    }));

    renderSection('PRO');

    await waitFor(() => expect(economyApi.economy).toHaveBeenCalledWith('p1'));
    // The one entry point for the first payment a master ever records has to be on the screen:
    // an advance arrives BEFORE the estimate is signed. Replacing the section with a flat
    // «ще немає підписаних кошторисів» took it away, and the save simply had nowhere to start.
    expect(await screen.findByText('Платежі')).toBeTruthy();
    expect(screen.getByText('+ Платіж')).toBeTruthy();
    expect(screen.getByText(/Ще нічого не записано/)).toBeTruthy();
    // The 0/0/0 noise that fix was right about still stays away: no percent against a zero
    // denominator, no splitting a contract that doesn't exist, no summary panel. Scoped to the
    // payments card — the acts and materials axes above legitimately print their own «· 0 %».
    expect(within(paymentsCard(screen.getByText('Платежі'))).queryByText(/%/)).toBeNull();
    expect(screen.queryByText('Розбити на частки')).toBeNull();
    expect(screen.queryByText('Загалом по підписаних')).toBeNull();
  });

  it('manually-created payments still show even with no SIGNED acts', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({
      estimates: [],
      pro: { expenses: 0, profit: 0 },
      payments: {
        contractedTotal: 0, received: 0, remaining: 0, materialRefunds: 0, refundApplied: 0,
        workPaid: 0, overpaid: 0, payments: [SAMPLE_PAYMENTS.payments[0]], unplannedReceipts: [],
      },
    }));

    renderSection('PRO');

    // The master already logged a payment by hand — show it as-is, and no empty-state line.
    expect(await screen.findByText('Аванс')).toBeTruthy();
    expect(screen.queryByText(/Ще нічого не записано/)).toBeNull();
  });

  it('an object carrying only unplanned receipts keeps them — and says how much landed', async () => {
    // These used to vanish outright: the old guard asked about PLAN rows and signed panels only,
    // so money already recorded against the object was simply not on the screen.
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({
      estimates: [],
      pro: { expenses: 0, profit: 0 },
      payments: {
        contractedTotal: 0, received: 4000, remaining: 0, materialRefunds: 0, refundApplied: 0,
        workPaid: 4000, overpaid: 0, payments: [],
        unplannedReceipts: [{ id: 'u1', planPaymentId: null, label: 'Завдаток', displayLabel: 'Завдаток', amount: 4000, receivedAt: '2026-09-01', materialRefund: false }],
      },
    }));

    renderSection('PRO');

    // A percent needs a denominator, but the sum does not — the collapsed row only says «· 1».
    const card = paymentsCard(await screen.findByText('Платежі'));
    expect(within(card).getByText(new RegExp(money(4000)))).toBeTruthy();
    expect(within(card).queryByText(/%/)).toBeNull();
    fireEvent.click(screen.getByText(/Отримано · 1/));
    expect(screen.getByText('Завдаток')).toBeTruthy();
  });

  it('an ADDENDUM rollup panel wears its badge — not an estimate the master forgot creating', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(
      economyFixture({ estimates: [panel({ name: 'Додаткові роботи до акта № 7', kind: 'ADDENDUM' })] }),
    );

    renderSection('FREE');

    expect(await screen.findByText('Додаткові роботи до акта № 7')).toBeTruthy();
    expect(screen.getByText('дод. роботи з акта')).toBeTruthy();
  });

  it('an ADDENDUM rollup has no ⋮ at all — both its actions were dead ends', async () => {
    // «Згенерувати акт» would open a scoped editor with no positions (WorkActService.progress
    // skips ADDENDUM estimates — this money IS an act already), and «Не враховувати цей кошторис»
    // is answered 409 ESTIMATE_ADDENDUM_LOCKED because unticking the rollup pushes «Прийнято
    // актами» past «За договором». A regular panel keeps its menu.
    vi.mocked(economyApi.economy).mockResolvedValue(
      economyFixture({
        estimates: [panel(), panel({ id: 'e2', name: 'Додаткові роботи до акта № 7', kind: 'ADDENDUM' })],
      }),
    );

    renderSection('PRO');

    await screen.findByText('Додаткові роботи до акта № 7');
    // Two panels on screen, exactly one ⋮ — the regular estimate keeps both its actions.
    expect(screen.getAllByLabelText('Дії')).toHaveLength(1);
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

  it('the act card shows a discount/markup recap at the percent the server sent', async () => {
    // The percent is no longer derived here: a «% від кошторису» line is measured against its own
    // TYPE subtotal, and dividing by works+materials is what printed «14,776%» for a 15 % discount.
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({
      estimates: [panel({ works: 8000, materials: 2000, markup: 0, discount: -1500, discountRate: -15, total: 8500 })],
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
    fireEvent.click(await screen.findByText('Не враховувати цей кошторис'));

    await waitFor(() => expect(estimatesApi.setCountInEconomy).toHaveBeenCalledWith('e1', false));
  });

  it('the works axis shows «Прийнято актами» and flips the balance wording by sign', async () => {
    // accepted 6000 < received 9000 → the master owes work → «Невідпрацьований аванс» = 3000.
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({
      acts: { contracted: 15000, acceptedByActs: 6000, received: 9000 },
    }));

    renderSection('FREE');

    // Balance label is a clean standalone node; the strip label is mixed with money in one span.
    expect(await screen.findByText('Невідпрацьований аванс')).toBeTruthy();
    expect(document.body.textContent).toContain('Прийнято актами');
  });

  it('the works axis names the client debt when acts outrun receipts', async () => {
    // accepted 9000 > received 3000 → the client owes for accepted work → «Заборгованість замовника».
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({
      acts: { contracted: 15000, acceptedByActs: 9000, received: 3000 },
    }));

    renderSection('FREE');

    expect(await screen.findByText('Заборгованість замовника')).toBeTruthy();
  });

  it('the act ⋮ menu offers «Згенерувати акт» when no act is open (acts iteration)', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture());
    vi.mocked(actsApi.list).mockResolvedValue([]);

    renderSection('FREE');

    await screen.findByText('Кухня');
    fireEvent.click(screen.getByLabelText('Дії'));
    expect(await screen.findByText('Згенерувати акт')).toBeTruthy();
  });

  it('«Згенерувати акт» is hidden while an act is still open', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture());
    vi.mocked(actsApi.list).mockResolvedValue([openAct()]);

    renderSection('FREE');

    await screen.findByText('Кухня');
    // Wait for the acts query to land so the block is computed, then open the menu.
    await waitFor(() => expect(actsApi.list).toHaveBeenCalledWith('p1'));
    fireEvent.click(screen.getByLabelText('Дії'));
    // The toggle item still renders — only «Згенерувати акт» is suppressed.
    await screen.findByText('Не враховувати цей кошторис');
    expect(screen.queryByText('Згенерувати акт')).toBeNull();
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

  it('the materials card ⓘ explains itself instead of navigating away', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({
      materials: { reimbursable: 4200, refundApplied: 0, outstanding: 4200, receiptCount: 3, unpricedCount: 0 },
    }));

    renderSection('FREE');

    // InfoPopover is itself a <button>. Nested inside the card's navigate button the ⓘ tap
    // bubbled and the master landed on the receipts list, never having read the explanation.
    fireEvent.click(await screen.findByRole('button', { name: 'Матеріали за чеками' }));

    expect(await screen.findByRole('dialog', { name: 'Матеріали за чеками' })).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('the materials card still opens the receipts list when the card itself is tapped', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({
      materials: { reimbursable: 4200, refundApplied: 0, outstanding: 4200, receiptCount: 3, unpricedCount: 0 },
    }));

    renderSection('FREE');

    fireEvent.click(await screen.findByText(/Матеріали за чеками/));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
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

/**
 * Review B-65. The materials axis answers «скільки клієнт мені ще винен за чеки» — so once he has
 * handed some of it back, the headline figure has to come DOWN. Showing the gross `reimbursable`
 * after a refund told the master he was owed money he had already been paid, on the same screen
 * that had just counted that refund as payment for work.
 */
describe('ObjectEconomySection — the materials axis nets what came back (B-65)', () => {
  it('shows what is still OWED, not what was ever laid out, and names the difference', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({
      materials: { reimbursable: 4200, refundApplied: 2000, outstanding: 2200, receiptCount: 3, unpricedCount: 0 },
    }));

    renderSection('FREE');

    const card = (await screen.findByText(/Матеріали за чеками/)).closest('button')!;
    expect(within(card).getByText(moneyExact(2200))).toBeTruthy();
    // The gross figure is not the answer to this question any more — and the refund is SAID, or
    // the drop from 4 200 to 2 200 reads as receipts having gone missing.
    expect(within(card).queryByText(moneyExact(4200))).toBeNull();
    // The refund line sits under the tappable part, not inside it — a whole card that navigates
    // would swallow the ⓘ next to it.
    expect(screen.getByText(new RegExp('повернуто'))).toBeTruthy();
  });

  it('says nothing about refunds when none came back', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({
      materials: { reimbursable: 4200, refundApplied: 0, outstanding: 4200, receiptCount: 3, unpricedCount: 0 },
    }));

    renderSection('FREE');

    const card = (await screen.findByText(/Матеріали за чеками/)).closest('button')!;
    expect(within(card).getByText(moneyExact(4200))).toBeTruthy();
    expect(screen.queryByText(/повернуто/)).toBeNull();
  });
});
