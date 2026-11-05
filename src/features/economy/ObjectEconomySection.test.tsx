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
import { paymentsApi } from '@/api/payments.ts';
import { formatMoney } from '@/lib/format.ts';
import type { CashEntryResponse, ObjectMoneyResponse, ObjectEconomyResponse, SignedEstimatePanelResponse, UserResponse, WorkActResponse } from '@/api/types.ts';

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
    money: vi.fn(),
    addExpense: vi.fn(),
    updateExpense: vi.fn(),
    deleteExpense: vi.fn(),
  },
}));
vi.mock('@/api/payments.ts', () => ({ paymentsApi: { addReceipt: vi.fn() } }));
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

/** «Гроші обʼєкта», addressed through its own heading. */
function moneyCard(heading: HTMLElement): HTMLElement {
  const card = heading.closest('section');
  if (!card) throw new Error('money heading is not inside a <section>');
  return card;
}

function moneyRow(over: Partial<CashEntryResponse> = {}): CashEntryResponse {
  return {
    id: 'm1', kind: 'OBJECT_PAYMENT', direction: 'INCOME', amount: 20000, category: null,
    note: 'Завдаток', happenedOn: '2026-10-12', projectId: 'p1', projectName: 'Франка 12',
    materialRefund: false, clientMaterial: false, noteLocked: false, readOnly: false,
    hasPhoto: false, ...over,
  };
}

function moneyFixture(over: Partial<ObjectMoneyResponse> = {}): ObjectMoneyResponse {
  return {
    income: 0, expense: 0, earned: 0,
    materials: { projectId: 'p1', projectName: 'Франка 12', bought: 0, given: 0, outstanding: 0 },
    crewRecorded: false, entries: [], truncated: false, ...over,
  };
}

function panel(overrides: Partial<SignedEstimatePanelResponse> = {}): SignedEstimatePanelResponse {
  return {
    id: 'e1', name: 'Кухня', works: 10000, materials: 5000, markup: 0, discount: 0,
    total: 15000, countedInEconomy: true, signedAt: '2026-07-01T00:00:00Z', kind: 'REGULAR' as const,
    ...overrides,
  };
}

// Part of the contract paid — these tests check FREE/PRO gating around the block.
const SAMPLE_PAYMENTS: NonNullable<ObjectEconomyResponse['payments']> = {
  contractedTotal: 15000,
  received: 1500,
  remaining: 13500,
  materialRefunds: 0,
  refundApplied: 0,
  workPaid: 1500,
  overpaid: 0,
  receipts: [{ id: 'r1', label: 'Аванс', displayLabel: 'Аванс', amount: 1500, receivedAt: '2026-07-01', materialRefund: false }],
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(economyApi.money).mockResolvedValue(moneyFixture());
});

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
    expect(await screen.findByText('Гроші обʼєкта')).toBeTruthy(); // the money card
    expect(screen.queryByText(/у PRO$/)).toBeNull(); // no lock teaser
  });

  it('PRO: shows the summary panel and payments, and «Заробіток» is gone for good', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({ pro: { expenses: 3500, profit: 10500 } }));

    renderSection('PRO');

    await waitFor(() => expect(economyApi.economy).toHaveBeenCalledWith('p1'));
    expect(await screen.findByText('Загалом по підписаних')).toBeTruthy(); // summary panel
    expect(await screen.findByText('Гроші обʼєкта')).toBeTruthy(); // the money card
    // «Прибуток» is GONE from the object, not hidden behind a flag: the formula subtracted
    // expenses no screen lets a master enter against an object, so it read ≈ «За договором» for
    // everyone. Earnings live in «Мої гроші». Asserted on the FIGURES the fixture carries (review
    // P-71): every label tried before named a string in no bundle, and an assertion that can never
    // fail is not a guard (P-52).
    expect(screen.queryByText(/10\s500/)).toBeNull(); // internals.profit
    expect(screen.queryByText(/3\s500/)).toBeNull(); // internals.expenses
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
    // Matched on the stable half: the sentence has plural forms now (review P-51), so «2 позиції
    // … додані» and «5 позицій … додано» are both this line.
    expect(screen.getByText(/без ціни бригади/)).toBeTruthy();
  });

  it('an ordinary estimate shows no crew figures at all', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(
      economyFixture({ estimates: [panel()], pro: { expenses: 0, profit: 0 } }));

    renderSection('PRO');

    await screen.findByText('Загалом по підписаних');
    expect(screen.queryByText('Бригаді')).toBeNull();
    expect(screen.queryByText('Твоя націнка')).toBeNull();
  });

  /**
   * «Гроші обʼєкта» (object-money iteration): what came in for the work, what he spent, what he
   * earned — the same arithmetic as «Мої гроші», read from the server. The payments card with its
   * plan stages and «Розбити на частки» is gone from the screen.
   */
  it('the money card shows income, spending and earnings, and no plan controls', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({ pro: { expenses: 0, profit: 0 } }));
    vi.mocked(economyApi.money).mockResolvedValue(moneyFixture({
      income: 42000, expense: 18500, earned: 23500, crewRecorded: true,
      entries: [moneyRow(), moneyRow({ id: 'm2', kind: 'OBJECT_EXPENSE', direction: 'EXPENSE', amount: 12000, category: 'CREW', note: 'Сашко' })],
    }));

    renderSection('PRO');

    const card = moneyCard(await screen.findByText('Гроші обʼєкта'));
    expect(within(card).getByText(new RegExp(money(23500)))).toBeTruthy();
    expect(screen.queryByText('Розбити на частки')).toBeNull();
    expect(screen.queryByText('+ Платіж')).toBeNull();
    expect(screen.queryByText(/Бригаді нічого не записано/)).toBeNull();
  });

  /** The rows fold under «✓ Отримано · N» / «Витрачено · N», as the payments card did: a year of
   *  crew pay would otherwise push the rest of the economy tab off screen. */
  it('folds the rows into an income group and a spending group, each opened on its own', async () => {
    vi.mocked(economyApi.money).mockResolvedValue(moneyFixture({
      income: 42000, expense: 12000, earned: 30000, crewRecorded: true,
      entries: [
        moneyRow({ note: 'Аванс від Олени' }),
        moneyRow({ id: 'm2', kind: 'OBJECT_EXPENSE', direction: 'EXPENSE', amount: 12000, category: 'CREW', note: 'Сашко' }),
      ],
    }));

    renderSection('PRO');

    const card = moneyCard(await screen.findByText('Гроші обʼєкта'));
    const inGroup = within(card).getByRole('button', { name: /Отримано · 1 платіж/ });
    const outGroup = within(card).getByRole('button', { name: /Витрачено · 1 запис/ });
    expect(within(card).queryByText('Сашко')).toBeNull();
    expect(within(card).queryByText('Аванс від Олени')).toBeNull();

    fireEvent.click(outGroup);
    expect(within(card).getByText('Сашко')).toBeTruthy();
    expect(within(card).queryByText('Аванс від Олени')).toBeNull();
    expect(outGroup.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(inGroup);
    expect(within(card).getByText('Аванс від Олени')).toBeTruthy();
  });

  /** Most masters have no crew — a «nothing paid to the crew» line that never goes away for them
   *  was noise, and the owner had it removed. */
  it('says nothing about a crew, even with money in and no crew pay recorded', async () => {
    vi.mocked(economyApi.money).mockResolvedValue(moneyFixture({ income: 20000, earned: 20000 }));

    renderSection('PRO');

    expect(await screen.findByText('Гроші обʼєкта')).toBeTruthy();
    expect(screen.queryByText(/Бригаді/)).toBeNull();
  });

  it('«Отримав» posts an object payment named by its purpose — the first one is the advance', async () => {
    vi.mocked(paymentsApi.addReceipt).mockResolvedValue([]);

    renderSection('PRO');

    fireEvent.click(await screen.findByRole('button', { name: '+ Додати' }));
    fireEvent.click(screen.getByRole('button', { name: /^Отримав/ }));
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '20000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    await waitFor(() => expect(paymentsApi.addReceipt).toHaveBeenCalled());
    expect(vi.mocked(paymentsApi.addReceipt).mock.calls[0][1]).toMatchObject({
      label: 'Завдаток', amount: 20000, materialRefund: false,
    });
  });

  it('«На матеріал» is the client\'s money, sent as such', async () => {
    vi.mocked(paymentsApi.addReceipt).mockResolvedValue([]);

    renderSection('PRO');

    fireEvent.click(await screen.findByRole('button', { name: '+ Додати' }));
    fireEvent.click(screen.getByRole('button', { name: /^Отримав/ }));
    fireEvent.click(screen.getByRole('button', { name: 'На матеріал' }));
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '10000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    await waitFor(() => expect(paymentsApi.addReceipt).toHaveBeenCalled());
    expect(vi.mocked(paymentsApi.addReceipt).mock.calls[0][1]).toMatchObject({
      label: 'На матеріал', amount: 10000, materialRefund: true,
    });
  });

  it('«Витратив» posts an object expense — the crew by default', async () => {
    vi.mocked(economyApi.addExpense).mockResolvedValue(undefined as never);

    renderSection('PRO');

    fireEvent.click(await screen.findByRole('button', { name: '+ Додати' }));
    fireEvent.click(screen.getByRole('button', { name: /^Витратив/ }));
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '12000' } });
    fireEvent.change(screen.getByPlaceholderText(/Сашко/), { target: { value: 'Сашко' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    await waitFor(() => expect(economyApi.addExpense).toHaveBeenCalled());
    expect(vi.mocked(economyApi.addExpense).mock.calls[0][1]).toMatchObject({
      amount: 12000, category: 'LABOR', note: 'Сашко',
    });
  });

  it('«📷 Чек» goes to the object\'s receipts, where «хто платить» is decided', async () => {
    renderSection('PRO');

    fireEvent.click(await screen.findByRole('button', { name: '+ Додати' }));
    fireEvent.click(screen.getByRole('button', { name: /📷 Чек/ }));

    // «←» on the receipts must land back on «Економіка», not the object's default tab.
    expect(mockNavigate).toHaveBeenCalledWith('/receipts/p1', { state: { from: '/projects/p1?tab=economy' } });
  });

  /**
   * A receipt on an act grows «За договором» — the client owes it now. A master read that growth as
   * a new expense; the line under the figure names what was added and by whom.
   */
  it('names what acts added to «За договором»', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(economyFixture({
      estimates: [
        panel(),
        panel({ id: 'e2', name: 'Матеріали за чеками до акта № 7', kind: 'ADDENDUM', works: 0, materials: 210.75, total: 210.75 }),
      ],
      acts: { contracted: 15210.75, acceptedByActs: 2810.75, received: 5000 },
    }));

    renderSection('FREE');

    expect(await screen.findByText(/з них додано актами/)).toBeTruthy();
    expect(screen.getByText(/з них додано актами/).textContent).toContain('210');
  });

  it('an ADDENDUM rollup panel wears its badge — not an estimate the master forgot creating', async () => {
    vi.mocked(economyApi.economy).mockResolvedValue(
      economyFixture({ estimates: [panel({ name: 'Додаткові роботи до акта № 7', kind: 'ADDENDUM' })] }),
    );

    renderSection('FREE');

    expect(await screen.findByText('Додаткові роботи до акта № 7')).toBeTruthy();
    expect(screen.getByText('з акта')).toBeTruthy();
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
 * The client's material money, on its own line of «Гроші обʼєкта»: what he gave, what was bought
 * for him, and where that leaves him — owes, money left, or settled.
 */
describe('ObjectEconomySection — the client\'s material line', () => {
  it('names the debt when the receipts outrun what he gave, and opens the receipts', async () => {
    vi.mocked(economyApi.money).mockResolvedValue(moneyFixture({
      materials: { projectId: 'p1', bought: 12500, given: 10000, outstanding: 2500 },
    }));

    renderSection('FREE');

    const line = await screen.findByText(new RegExp('Клієнт винен за матеріал ' + money(2500)));
    fireEvent.click(line);
    expect(mockNavigate).toHaveBeenCalledWith('/receipts/p1', expect.anything());
  });

  /** What was left of his material money paid a signed act's receipts: said, and the line settles. */
  it('says how much of the material money went into acts', async () => {
    vi.mocked(economyApi.money).mockResolvedValue(moneyFixture({
      materials: { projectId: 'p1', projectName: 'Франка 12', bought: 763.72, given: 5000, toActs: 4236.28, outstanding: 0 },
    }));

    renderSection('PRO');

    expect(await screen.findByText(new RegExp('в акти ' + money(4236.28)))).toBeTruthy();
    expect(screen.getByText(/За матеріал розраховано/)).toBeTruthy();
  });

  it('names his money still unspent when he paid ahead', async () => {
    vi.mocked(economyApi.money).mockResolvedValue(moneyFixture({
      materials: { projectId: 'p1', bought: 7300, given: 10000, outstanding: -2700 },
    }));

    renderSection('FREE');

    expect(await screen.findByText(new RegExp('Лишилось з грошей клієнта ' + money(2700)))).toBeTruthy();
  });

  it('says nothing when there is no material money at all', async () => {
    renderSection('FREE');

    await screen.findByText('Гроші обʼєкта');
    expect(screen.queryByText(/Матеріал клієнта/)).toBeNull();
  });
});
