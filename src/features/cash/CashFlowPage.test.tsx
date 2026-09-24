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
    ...over,
  };
}

function flow(over: Partial<CashFlowResponse> = {}): CashFlowResponse {
  return {
    from: '2026-09-01',
    to: '2026-09-30',
    income: 0,
    expense: 0,
    earned: 0,
    refunds: 0,
    entries: [],
    months: [],
    truncated: false,
    ...over,
  };
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
    expect(screen.getByText(/повернення за матеріал/)).toBeTruthy();
  });

  it('does not explain a gap that is not there', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow({
      income: 5000, expense: 1000, earned: 4000, entries: [entry()],
    }));

    renderPage();

    await waitFor(() => expect(screen.getByText('Дизель')).toBeTruthy());
    expect(screen.queryByText(/повернення за матеріал/)).toBeNull();
  });

  /** An off-object row says so: «без обʼєкта» is an answer, a blank line is a question. */
  it('names the object a row came from, or says there is none', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow({
      entries: [
        entry(),
        entry({ id: 'e2', kind: 'OBJECT_EXPENSE', projectId: 'p1', projectName: 'Квартира на Лесі' }),
      ],
    }));

    renderPage();

    await waitFor(() => expect(screen.getByText('Без обʼєкта')).toBeTruthy());
    expect(screen.getByText('Квартира на Лесі')).toBeTruthy();
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
    fireEvent.click(await screen.findByText('Дизель'));
    fireEvent.click(screen.getByRole('button', { name: 'Видалити' }));

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

  /** Two date fields on a phone are tapped in whatever order — reversed bounds are not an error. */
  it('swaps a reversed range instead of asking for nothing', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow({}));

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Період' }));
    fireEvent.change(screen.getByLabelText('Від'), { target: { value: '2026-09-30' } });

    await waitFor(() => expect(vi.mocked(cashApi.flow).mock.calls.some(
      ([p]) => p?.from != null && p.to != null && p.from <= p.to,
    )).toBe(true));
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
    fireEvent.click(screen.getByRole('checkbox')); // «це повернення за матеріал»
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    await waitFor(() => expect(cashApi.add).toHaveBeenCalled());
    expect(vi.mocked(cashApi.add).mock.calls[0][0]).toMatchObject({
      direction: 'INCOME', amount: 5000, materialRefund: true, kind: null,
    });
  });

  /** The refund tick is an income idea; on spending it would skew «Заробив» the other way. */
  it('offers the refund tick only on income', async () => {
    vi.mocked(cashApi.flow).mockResolvedValue(flow());

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Додати запис/ }));

    expect(screen.getByRole('checkbox')).toBeTruthy(); // opens on «Отримав»
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
