import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { CashFlowPage } from './CashFlowPage.tsx';
import { cashApi } from '@/api/cash.ts';
import type { CashEntryResponse, CashFlowResponse } from '@/api/types.ts';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('@/api/cash.ts', () => ({
  cashApi: { flow: vi.fn(), summary: vi.fn(), add: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));
vi.mock('@/features/projects/useProjects.ts', () => ({
  useProjects: () => ({ data: [{ id: 'p1', name: 'Квартира на Лесі', stage: 'IN_PROGRESS' }] }),
}));

function entry(over: Partial<CashEntryResponse> = {}): CashEntryResponse {
  return {
    id: 'e1',
    kind: 'PERSONAL',
    direction: 'EXPENSE',
    amount: 1200,
    category: 'FUEL',
    note: 'Дизель',
    happenedOn: '2026-09-10',
    happenedAt: '2026-09-10T08:00:00Z',
    projectId: null,
    projectName: null,
    materialRefund: false,
    noteLocked: false,
    readOnly: false,
    ...over,
  };
}

/** The slices the server sends, derived from the rows the same way unless a test names its own. */
function flow(over: Partial<CashFlowResponse> = {}): CashFlowResponse {
  const entries = over.entries ?? [];
  const slice = (rows: CashEntryResponse[]) => {
    const own = rows.filter((e) => e.clientMaterial !== true);
    const income = own.filter((e) => e.direction === 'INCOME').reduce((s, e) => s + e.amount, 0);
    const expense = own.filter((e) => e.direction === 'EXPENSE').reduce((s, e) => s + e.amount, 0);
    return { income, expense, earned: income - expense };
  };
  const ids = [...new Set(entries.flatMap((e) => (e.projectId ? [e.projectId] : [])))];
  const personalRows = entries.filter((e) => e.projectId == null);
  return {
    from: '2026-09-01',
    to: '2026-09-30',
    income: 0,
    expense: 0,
    earned: 0,
    refunds: 0,
    entries,
    months: [],
    truncated: false,
    objects: ids.map((id) => {
      const rows = entries.filter((e) => e.projectId === id);
      return { projectId: id, projectName: rows[0].projectName ?? null, ...slice(rows) };
    }),
    personal: personalRows.length > 0 ? { projectId: null, projectName: null, ...slice(personalRows) } : null,
    ...over,
  };
}

/** Object rows sit folded under their object's line. */
async function openObject(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
}

function renderPage(state?: { from?: string; period?: 'WEEK' | 'MONTH' | 'YEAR' }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[{ pathname: '/finance', state: state ?? null }]}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<CashFlowPage />, { wrapper });
}

describe('CashFlowPage', () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * «Прийшло» and «Заробив» answer different questions, and the gap between them has to be
   * explained or it reads as our arithmetic slipping.
   */
  it('shows three numbers and says why earnings are lower than what came in', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow({
      income: 28000, expense: 3000, refunds: 8000, earned: 17000,
      entries: [entry()],
    }));

    renderPage();

    await waitFor(() => expect(screen.getByText(/17\D*000/)).toBeTruthy());
    expect(screen.getByText('Прийшло')).toBeTruthy();
    expect(screen.getByText('Заробив')).toBeTruthy();
    expect(screen.getByText(/Клієнти дали на матеріал/)).toBeTruthy();
    // No balance block below, so the line points at nothing.
    expect(screen.queryByText(/Скільки з них лишилось/)).toBeNull();
  });

  /** It says what clients HANDED OVER — what is left after the receipts is the block below, and
   *  the line says so rather than read as the balance itself. */
  it('points at the balance below when there is one', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow({
      income: 0, expense: 0, refunds: 5000, earned: 0,
      materials: [{ projectId: 'p1', projectName: 'Тест Б', bought: 763.72, given: 5000, outstanding: -4236.28 }],
    }));

    renderPage();

    expect(await screen.findByText(/Клієнти дали на матеріал .*Скільки з них лишилось — нижче/)).toBeTruthy();
  });

  it('does not explain a gap that is not there', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow({
      income: 5000, expense: 1000, earned: 4000, entries: [entry()],
    }));

    renderPage();

    await waitFor(() => expect(screen.getByText('Дизель')).toBeTruthy());
    expect(screen.queryByText(/Клієнти дали на матеріал/)).toBeNull();
  });

  /**
   * A receipt frozen into a signed act's `doc_hash` can only be refused (409). The month still has
   * to add up, so the row stays — but it carries no tap at all: an affordance that can only fail
   * is how the master decides the app is broken.
   */
  it('shows a row locked by a signed act, and offers no tap on it', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow({
      entries: [entry({
        id: 'e9', kind: 'ACT_RECEIPT', direction: 'EXPENSE', note: 'Плитка',
        category: null, projectId: 'p1', projectName: 'Квартира на Лесі', readOnly: true,
      })],
    }));

    renderPage();
    await openObject('Квартира на Лесі');

    const label = await screen.findByText('Плитка');
    expect(screen.getByText(/у підписаному акті/)).toBeTruthy();
    expect(label.closest('button')).toBeNull();
    // And nothing opens if it is tapped anyway.
    fireEvent.click(label);
    expect(screen.queryByRole('button', { name: 'Зберегти' })).toBeNull();
  });

  /**
   * Objects and «особисте» apart (master's ask): a job's rows fold under that object's line with
   * what it earned, his own rows sit in their own block — never one mixed list.
   */
  it('splits the rows into objects and «Особисте», each object folded under its line', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow({
      entries: [
        entry({ note: 'Робочий одяг', amount: 800 }),
        entry({ id: 'e2', kind: 'OBJECT_EXPENSE', projectId: 'p1', projectName: 'Квартира на Лесі', note: 'Доставка', amount: 500 }),
        entry({ id: 'e3', kind: 'OBJECT_PAYMENT', direction: 'INCOME', projectId: 'p1', projectName: 'Квартира на Лесі', note: 'За роботу', amount: 10000, category: null }),
      ],
      income: 10000, expense: 1300, earned: 8700,
    }));

    renderPage();

    expect(await screen.findByText(/Особисте$/)).toBeTruthy();
    expect(screen.getByText('Робочий одяг')).toBeTruthy();
    // The object's line carries what it earned; its rows wait for a tap.
    const line = screen.getByRole('button', { name: /Квартира на Лесі/ });
    expect(line.textContent).toMatch(/9\D*500/);
    expect(screen.queryByText('Доставка')).toBeNull();
    // «Заробив» split the same way, adding up: 9 500 − 800 = 8 700.
    expect(screen.getByText('по обʼєктах')).toBeTruthy();

    fireEvent.click(line);
    expect(screen.getByText('Доставка')).toBeTruthy();
    expect(line.getAttribute('aria-expanded')).toBe('true');
  });

  it('one object filtered in shows its rows without a tap', async () => {
    localStorage.setItem('majstr.cash-object', 'p1');
    vi.mocked(cashApi.flow).mockResolvedValue(flow({
      entries: [entry({ id: 'e2', kind: 'OBJECT_EXPENSE', projectId: 'p1', projectName: 'Квартира на Лесі', note: 'Доставка' })],
    }));

    renderPage();

    expect(await screen.findByText('Доставка')).toBeTruthy();
    localStorage.removeItem('majstr.cash-object');
  });

  /**
   * An object's row is edited HERE (master's ruling: «з можливістю видаляти рядки чи едітати»). It
   * is a second door to one record, never a second copy — the PATCH says which table to write
   * through, and the server routes it to the object's own service.
   */
  it('edits an object payment in place, and says which table to write through', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow({
      entries: [entry({
        id: 'e2', kind: 'OBJECT_PAYMENT', direction: 'INCOME', note: 'Завдаток', category: null,
        projectId: 'p1', projectName: 'Квартира на Лесі',
      })],
    }));
    vi.mocked(cashApi.update).mockResolvedValue(entry());

    renderPage();
    await openObject('Квартира на Лесі');
    fireEvent.click(await screen.findByText('Завдаток'));

    // No bouncing away to the object — it opens right here.
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByText('З обʼєкта: Квартира на Лесі')).toBeTruthy();
    // A payment is income BY BEING a payment, and it has no category — offering either would be a
    // field the object's own table does not have.
    expect(screen.queryByRole('button', { name: 'Витратив' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Матеріали' })).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '6500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    await waitFor(() => expect(cashApi.update).toHaveBeenCalled());
    expect(vi.mocked(cashApi.update).mock.calls[0][1]).toMatchObject({
      amount: 6500, kind: 'OBJECT_PAYMENT',
    });
  });

  /** A PLANNED receipt is named by its stage — a field that discards what he types is worse than
   *  one that says it is not his to change. */
  it('does not offer to rename a payment that belongs to a stage', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow({
      entries: [entry({
        id: 'e2', kind: 'OBJECT_PAYMENT', direction: 'INCOME', note: 'Аванс', category: null,
        projectId: 'p1', projectName: 'Квартира на Лесі', noteLocked: true,
      })],
    }));

    renderPage();
    await openObject('Квартира на Лесі');
    fireEvent.click(await screen.findByText('Аванс'));

    expect(screen.getByDisplayValue('Аванс').hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/з етапу оплат/)).toBeTruthy();
  });

  it('deletes any row, telling the server which table it lives in', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow({
      entries: [entry({
        id: 'e2', kind: 'OBJECT_EXPENSE', projectId: 'p1', projectName: 'Квартира на Лесі',
      })],
    }));
    vi.mocked(cashApi.remove).mockResolvedValue(undefined);

    renderPage();
    await openObject('Квартира на Лесі');
    fireEvent.click(await screen.findByText('Дизель'));
    fireEvent.click(screen.getByRole('button', { name: 'Видалити' }));
    // Asked first (review P-27): the write goes through that object's own service and there is no
    // undo behind it — every other delete in the app confirms, and this one deleted on one tap.
    fireEvent.click(await screen.findByRole('button', { name: 'Так, видалити' }));

    await waitFor(() => expect(cashApi.remove).toHaveBeenCalledWith('e2', 'OBJECT_EXPENSE'));
  });

  it('opens his OWN row for editing', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow({ entries: [entry()] }));

    renderPage();
    fireEvent.click(await screen.findByText('Дизель'));

    expect(await screen.findByText('Запис')).toBeTruthy();
    // His own row keeps the full sheet: direction is a real choice there.
    expect(screen.getByRole('button', { name: 'Витратив' })).toBeTruthy();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  /** The year view lists MONTHS: two thousand rows is not a screen anyone reads on a phone. */
  it('lists months on the year tab, and drills into one', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow({
      months: [
        { month: '2026-09-01', income: 42000, expense: 18500, earned: 23500 },
        { month: '2026-08-01', income: 12000, expense: 3000, earned: 9000 },
      ],
    }));

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Рік' }));

    await waitFor(() => expect(screen.getByText('вересень')).toBeTruthy());
    // Asked the server for months, not for a list it would then have to cut.
    expect(vi.mocked(cashApi.flow).mock.calls.some(([p]) => p?.monthly === true)).toBe(true);

    fireEvent.click(screen.getByText('серпень'));
    await waitFor(() => expect(
      vi.mocked(cashApi.flow).mock.calls.some(([p]) => p?.from === '2026-08-01'),
    ).toBe(true));
  });

  /** A month with no spending said «−0 ₴», which read as a spend that went missing. */
  it('leaves out the side of a month that has nothing on it', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow({
      months: [{ month: '2026-10-01', income: 5000, expense: 0, earned: 5000 }],
    }));

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Рік' }));

    const row = (await screen.findByText('жовтень')).closest('button')!;
    expect(row.textContent).toContain('+5');
    expect(row.textContent).not.toContain('−');
  });

  /**
   * «Період» — two dates the master picks himself, for the window none of the three buttons is:
   * a job that ran from the 12th to the 3rd, a quarter, last September.
   */
  it('asks the server for the dates the master picked', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow({}));

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Період' }));

    fireEvent.change(screen.getByLabelText('Від'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('До'), { target: { value: '2026-08-31' } });

    await waitFor(() => expect(vi.mocked(cashApi.flow).mock.calls.some(
      ([p]) => p?.from === '2026-08-01' && p?.to === '2026-08-31',
    )).toBe(true));
    // A window he chose is a list, never the year view's month totals.
    expect(vi.mocked(cashApi.flow).mock.calls.every(([p]) => p?.monthly !== true)).toBe(true);
  });

  /**
   * Two date fields on a phone are tapped in whatever order — reversed bounds are not an error.
   *
   * <p>Pinned against a FIXED clock and asserted on the exact call: the old version asked whether
   * ANY request had `from <= to`, which the screen's own opening WEEK already satisfied, so it
   * would have stayed green with the custom range wired to nothing at all (review P-45).</p>
   */
  it('swaps a reversed range instead of asking for nothing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 8, 10, 12)); // Thu 10 Sep 2026
    vi.mocked(cashApi.flow).mockResolvedValue(flow({}));

    renderPage();
    // The default tab, computed on his own phone: Monday 7 Sep to Sunday 13 Sep.
    await waitFor(() => expect(cashApi.flow).toHaveBeenCalledWith({
      from: '2026-09-07', to: '2026-09-13', monthly: false, object: 'ALL',
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Період' }));
    fireEvent.change(screen.getByLabelText('Від'), { target: { value: '2026-09-30' } });

    await waitFor(() => expect(cashApi.flow).toHaveBeenCalledWith({
      from: '2026-09-13', to: '2026-09-30', monthly: false, object: 'ALL',
    }));
    vi.useRealTimers();
  });

  /**
   * A `<input type="date">` reports every intermediate year while a keyboard is used, and each
   * answer became its own query key persisted for a week — above 9999 the screen went to its
   * error state over a date half-typed (review P-45).
   */
  it('ignores a half-typed year instead of asking the server about it', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow({}));

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Період' }));
    for (const half of ['0002-09-01', '0020-09-01', '0202-09-01']) {
      fireEvent.change(screen.getByLabelText('Від'), { target: { value: half } });
    }

    expect(vi.mocked(cashApi.flow).mock.calls.every(([p]) => (p?.from ?? '') >= '2000-01-01'))
      .toBe(true);
    // And the field still shows what he typed — it is committed, not corrected under him.
    expect(screen.getByLabelText<HTMLInputElement>('Від').value).toBe('0202-09-01');
  });

  /**
   * Clearing one field used to send `''`, which the server reads as «no bound» and answers about
   * its own default month — the screen then showed figures for a window it had not asked about.
   */
  it('falls back to the other bound when a field is cleared', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow({}));

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Період' }));
    fireEvent.change(screen.getByLabelText('Від'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('До'), { target: { value: '2026-08-31' } });
    await waitFor(() => expect(cashApi.flow).toHaveBeenCalledWith({
      from: '2026-08-01', to: '2026-08-31', monthly: false, object: 'ALL',
    }));

    fireEvent.change(screen.getByLabelText('До'), { target: { value: '' } });

    await waitFor(() => expect(cashApi.flow).toHaveBeenCalledWith({
      from: '2026-08-01', to: '2026-08-01', monthly: false, object: 'ALL',
    }));
    expect(vi.mocked(cashApi.flow).mock.calls.every(([p]) => p?.to !== '')).toBe(true);
  });

  /** Totals cover everything even when the list does not — a screen that quietly hides money is
   *  worse than one that admits it. */
  it('says when the list was cut', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow({
      income: 99999, entries: [entry()], truncated: true,
    }));

    renderPage();

    expect(await screen.findByText(/Суми вгорі — за весь період/)).toBeTruthy();
  });

  /**
   * The sheet opens on «Отримав» (master's call): what he reaches for this screen to write down is
   * most often money he has just been handed. And it asks NOTHING about an object — that money is
   * already in the object's journal and arrives on the read path by itself.
   */
  it('opens on income and never asks about an object', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow());
    vi.mocked(cashApi.add).mockResolvedValue(entry());

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Додати запис/ }));

    expect(screen.getByRole('button', { name: 'Отримав' }).getAttribute('aria-pressed')).toBe('true');
    // No picker, no list, nothing to choose: the screen already pulls every object.
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText('Без обʼєкта')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    await waitFor(() => expect(cashApi.add).toHaveBeenCalled());
    expect(vi.mocked(cashApi.add).mock.calls[0][0]).toMatchObject({
      direction: 'INCOME', amount: 5000, materialRefund: false, kind: null,
    });
  });

  /**
   * An amount nobody typed may not reach the server, and a `NaN` may not reach IndexedDB.
   *
   * <p>`parseDecimal` answered `NaN` for «12а», «1.200,50» and a Unicode minus, and `NaN` fails
   * neither `== null` nor `<= 0` — so the sheet closed, the text was gone, and offline the row
   * rendered «NaN ₴» and poisoned the totals until the queue blocked hours later (review
   * P-20).</p>
   */
  it('refuses an amount it cannot read, and keeps the sheet open', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow());
    vi.mocked(cashApi.add).mockResolvedValue(entry());

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Додати запис/ }));

    for (const typo of ['12а', '1.200,50', '\u22125', '0,004', '']) {
      fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: typo } });
      fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
      expect(await screen.findByText(/Сума не читається/)).toBeTruthy();
    }
    expect(cashApi.add).not.toHaveBeenCalled();

    // A phone keypad's «1 200» IS readable, and that is the point of the helper.
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '1 200,50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    await waitFor(() => expect(cashApi.add).toHaveBeenCalled());
    expect(vi.mocked(cashApi.add).mock.calls[0][0]).toMatchObject({ amount: 1200.5 });
  });

  /**
   * An object's expense has only the three buckets `object_expenses` stores. FUEL, TOOLS and TAXES
   * fold into OTHER on the way in, so offering them asked a question and discarded the answer.
   */
  it('offers an object expense only the categories its own table has', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow({
      entries: [entry({ id: 'e2', kind: 'OBJECT_EXPENSE', projectName: 'Квартира на Лесі' })],
    }));

    renderPage();
    fireEvent.click(await screen.findByText('Дизель'));

    expect(screen.getByRole('button', { name: 'Матеріали' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Бригада' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Інше' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Пальне' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Податки' })).toBeNull();
  });

  /** The refund tick is an income idea; on spending it would skew «Заробив» the other way. */
  /** His own row is his own money: «на матеріал» belongs to an object's payment (object-money). */
  it('never asks «на матеріал» on a row of his own', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow());

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Додати запис/ }));

    expect(screen.queryByRole('checkbox')).toBeNull(); // opens on «Отримав»
    fireEvent.click(screen.getByRole('button', { name: 'Витратив' }));
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  /**
   * «←» goes back to the door he came IN by. Two doors reach this screen — the home strip and the
   * Профіль row — and always landing on the dashboard is what the master hit («коли тисну назад з
   * Мої гроші я хочу повертатись в Профіль»).
   */
  it('goes back to the door it was opened from', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow());

    renderPage({ from: '/profile' });
    fireEvent.click(await screen.findByRole('button', { name: 'Назад' }));

    expect(navigateMock).toHaveBeenCalledWith('/profile');
  });

  it('goes back to the dashboard when that is where it came from', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow());

    renderPage({ from: '/' });
    fireEvent.click(await screen.findByRole('button', { name: 'Назад' }));

    expect(navigateMock).toHaveBeenCalledWith('/');
  });

  /** A reload carries no state — and «Мої гроші» is his own section, so Профіль is where it lands. */
  it('falls back to Профіль when it was opened cold', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow());

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Назад' }));

    expect(navigateMock).toHaveBeenCalledWith('/profile');
  });

  /**
   * The home strip sums a MONTH while this screen otherwise opens on the week, so the tap carries
   * the window with it — landing on a smaller number than the one he just tapped is the one thing
   * a money screen may not do.
   */
  it('opens on the month when the home strip sent it there', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow());

    renderPage({ from: '/', period: 'MONTH' });

    await waitFor(() => expect(cashApi.flow).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Місяць' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Тиждень' }).getAttribute('aria-pressed')).toBe('false');
  });

  /** «за цей тиждень» is the question he opens the screen with (master's call). */
  it('opens on the week', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow());

    renderPage();

    await waitFor(() => expect(cashApi.flow).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Тиждень' }).getAttribute('aria-pressed')).toBe('true');
    // And the screen says out loud that it already covers every object — the thing that was
    // missing when the object picker read as «pick one or nothing happens».
    expect(screen.getByText('Усі обʼєкти разом')).toBeTruthy();
  });
});

/**
 * Object-money iteration: a filter on the READ (never a step in front of adding) and the clients'
 * material debts, which are in none of the three figures and so need a line of their own.
 */
describe('CashFlowPage — object filter and material debts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('opens on every object, and asks the server about one once it is picked', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow());

    renderPage();
    await waitFor(() => expect(cashApi.flow).toHaveBeenCalledWith(
      expect.objectContaining({ object: 'ALL' })));

    fireEvent.click(screen.getByRole('button', { name: 'Обʼєкт' }));
    fireEvent.click(screen.getByRole('button', { name: 'Квартира на Лесі' }));

    await waitFor(() => expect(cashApi.flow).toHaveBeenCalledWith(
      expect.objectContaining({ object: 'p1' })));
    expect(localStorage.getItem('majstr.cash-object')).toBe('p1');
  });

  it("lists what clients owe for material, and opens that object's receipts", async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow({
      materials: [
        { projectId: 'p1', projectName: 'Квартира на Лесі', bought: 5000, given: 1200, outstanding: 3800 },
        { projectId: 'p2', projectName: 'Садова 4', bought: 0, given: 3000, outstanding: -3000 },
      ],
    }));

    renderPage();

    expect(await screen.findByText(/Клієнти винні за матеріал/)).toBeTruthy();
    expect(screen.getByText(/лишилось його/)).toBeTruthy();
    fireEvent.click(screen.getByText('Квартира на Лесі'));
    expect(navigateMock).toHaveBeenCalledWith('/receipts/p1', expect.anything());
  });

  /** Part of an act's purchase paid with the client's material money: the row is his own share,
   *  the paper's total said beside it, and the edit opens on the paper's figure. */
  it('shows the part of a purchase the client paid, and edits the whole paper', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow({
      entries: [entry({
        id: 'x1', kind: 'OBJECT_EXPENSE', amount: 12151.72, clientShare: 4236.28,
        note: 'Чек до акта № 9: Електромаркет', category: 'MATERIALS',
        projectId: 'p1', projectName: 'Тест Б',
      })],
    }));

    renderPage();
    await openObject('Тест Б');

    expect(await screen.findByText(/з них .*4\D*236,28.* з грошей клієнта на матеріал/)).toBeTruthy();
    fireEvent.click(screen.getByText('Чек до акта № 9: Електромаркет'));
    expect(screen.getByPlaceholderText<HTMLInputElement>('0').value).toBe('16388');
  });

  it("draws the client's material money without a sign", async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow({
      entries: [entry({
        id: 't1', kind: 'OBJECT_RECEIPT', note: 'Епіцентр', amount: 4300, clientMaterial: true,
        projectId: 'p1', projectName: 'Квартира на Лесі', category: 'MATERIALS',
      })],
    }));

    renderPage();
    await openObject('Квартира на Лесі');

    // Neutral: paid ahead or not, the balance line says who owes whom — not the row.
    expect(await screen.findByText(/куплено для клієнта/)).toBeTruthy();
    expect(screen.queryByText(/−\s*4\s*300/)).toBeNull();
  });
});
