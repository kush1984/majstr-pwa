import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { PaymentsBlock } from './PaymentsBlock.tsx';
import { paymentsApi } from '@/api/payments.ts';
import type { PaymentsSummaryResponse, PaymentReceiptResponse, ProjectPaymentResponse } from '@/api/types.ts';

vi.mock('@/api/payments.ts', () => ({
  paymentsApi: {
    add: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    previewSplit: vi.fn(),
    commitSplit: vi.fn(),
    addReceipt: vi.fn(),
    editReceipt: vi.fn(),
    removeReceipt: vi.fn(),
    transferSurplus: vi.fn(),
  },
}));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

function receipt(overrides: Partial<PaymentReceiptResponse> = {}): PaymentReceiptResponse {
  return {
    id: 'rcpt1', planPaymentId: 'pay1', label: null, displayLabel: 'Аванс',
    amount: 2000, receivedAt: '2026-08-01', materialRefund: false, ...overrides,
  };
}

function plannedRow(overrides: Partial<ProjectPaymentResponse> = {}): ProjectPaymentResponse {
  return {
    id: 'pay1', amount: 5000, dueDate: '2026-08-15', nextStage: 'Чорнові роботи',
    purpose: 'Аванс', received: 0, remaining: 5000, status: 'PLANNED', sortOrder: 0, receipts: [],
    ...overrides,
  };
}

function summary(payments: ProjectPaymentResponse[] = [], unplannedReceipts: PaymentReceiptResponse[] = []): PaymentsSummaryResponse {
  const received = payments.reduce((s, p) => s + p.received, 0) + unplannedReceipts.reduce((s, r) => s + r.amount, 0);
  // The server's own split (B-65): only what did NOT come back for material pays for work.
  const refunds = unplannedReceipts.filter((r) => r.materialRefund).reduce((s, r) => s + r.amount, 0);
  const workPaid = received - refunds;
  return {
    contractedTotal: 20000, received, remaining: Math.max(0, 20000 - workPaid),
    materialRefunds: refunds, refundApplied: refunds, workPaid,
    overpaid: Math.max(0, workPaid - 20000), payments, unplannedReceipts,
  };
}

function renderBlock(s: PaymentsSummaryResponse, materialsOutstanding = 0) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <PaymentsBlock objectId="obj1" summary={s} materialsOutstanding={materialsOutstanding} />,
    { wrapper },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  onlineManager.setOnline(true);
});

describe('PaymentsBlock — plan vs fact (payments PLAN/FACT split, V100)', () => {
  it('"+ Платіж" offers a choice between planned and already-received', () => {
    renderBlock(summary());

    fireEvent.click(screen.getByText('+ Платіж'));

    expect(screen.getByText('Запланований')).toBeTruthy();
    expect(screen.getByText('Вже отримано')).toBeTruthy();
  });

  it('the planned form has no fact fields at all, and creates a pure plan row', async () => {
    vi.mocked(paymentsApi.add).mockResolvedValue(plannedRow());
    renderBlock(summary());

    fireEvent.click(screen.getByText('+ Платіж'));
    fireEvent.click(screen.getByText('Запланований'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText('Отримано')).toBeNull();
    fireEvent.change(within(dialog).getByPlaceholderText('напр. Аванс, Фінал'), { target: { value: 'Аванс' } });
    fireEvent.change(within(dialog).getByPlaceholderText('0 ₴'), { target: { value: '5000' } });
    fireEvent.click(within(dialog).getByText('Зберегти'));

    await waitFor(() => expect(paymentsApi.add).toHaveBeenCalled());
    const [, req] = vi.mocked(paymentsApi.add).mock.calls[0];
    expect(req).toEqual({ purpose: 'Аванс', amount: 5000, dueDate: null, nextStage: null });
  });

  it('"Вже отримано" with no plan stages goes straight to "Своє" and registers an unplanned receipt', async () => {
    vi.mocked(paymentsApi.addReceipt).mockResolvedValue([receipt({ planPaymentId: null, label: 'Завдаток' })]);
    renderBlock(summary());

    fireEvent.click(screen.getByText('+ Платіж'));
    fireEvent.click(screen.getByText('Вже отримано'));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('напр. Завдаток, продаж інструменту'), { target: { value: 'Завдаток' } });
    fireEvent.change(within(dialog).getByPlaceholderText('0 ₴'), { target: { value: '3000' } });
    fireEvent.click(within(dialog).getByText('Зберегти'));

    await waitFor(() => expect(paymentsApi.addReceipt).toHaveBeenCalled());
    const [, req] = vi.mocked(paymentsApi.addReceipt).mock.calls[0];
    expect(req).toMatchObject({ planPaymentId: null, label: 'Завдаток', amount: 3000 });
  });

  it('a plan stage row offers "Отримати платіж", preselected with the stage and its remaining amount', async () => {
    const row = plannedRow({ received: 2000, remaining: 3000, status: 'PARTIAL', receipts: [receipt({ amount: 2000 })] });
    vi.mocked(paymentsApi.addReceipt).mockResolvedValue([receipt({ amount: 3000 })]);
    renderBlock(summary([row]));

    fireEvent.click(screen.getByText('Аванс')); // open the row's edit sheet
    fireEvent.click(screen.getByText('Отримати платіж'));

    // The receive sheet defaults the amount to the stage's remaining balance.
    expect(screen.getByDisplayValue('3000')).toBeTruthy();
    fireEvent.click(screen.getByText('Зберегти'));

    await waitFor(() => expect(paymentsApi.addReceipt).toHaveBeenCalled());
    const [, req] = vi.mocked(paymentsApi.addReceipt).mock.calls[0];
    expect(req).toMatchObject({ planPaymentId: 'pay1', amount: 3000, resolution: null });
  });

  it('an exact partial payment closes without asking for an overflow resolution', async () => {
    const row = plannedRow({ remaining: 5000 });
    vi.mocked(paymentsApi.addReceipt).mockResolvedValue([receipt({ amount: 2000 })]);
    renderBlock(summary([row]));

    fireEvent.click(screen.getByText('Аванс'));
    fireEvent.click(screen.getByText('Отримати платіж'));
    fireEvent.change(screen.getByPlaceholderText('0 ₴'), { target: { value: '2000' } });
    fireEvent.click(screen.getByText('Зберегти'));

    await waitFor(() => expect(paymentsApi.addReceipt).toHaveBeenCalled());
    expect(screen.queryByText(/Отримано на/)).toBeNull(); // no overflow dialog
  });

  it('overpaying a stage that HAS a next open one offers "перенести" and "збільшити"', async () => {
    const first = plannedRow({ id: 'pay1', purpose: 'Аванс', amount: 5000, remaining: 5000, sortOrder: 0 });
    const next = plannedRow({ id: 'pay2', purpose: 'Фінал', amount: 3000, remaining: 3000, sortOrder: 1 });
    vi.mocked(paymentsApi.addReceipt).mockResolvedValue([receipt(), receipt({ id: 'rcpt2' })]);
    renderBlock(summary([first, next]));

    fireEvent.click(screen.getByText('Аванс'));
    fireEvent.click(screen.getByText('Отримати платіж'));
    fireEvent.change(screen.getByPlaceholderText('0 ₴'), { target: { value: '7000' } });
    fireEvent.click(screen.getByText('Зберегти'));

    // Two dialogs are stacked now (the receive sheet + the overflow confirm on top of it) — the
    // background timeline and the receive sheet's own stage picker ALSO say "Фінал", so scope
    // strictly to the topmost (last-mounted) dialog.
    const dialogs = await screen.findAllByRole('dialog');
    const overflowDialog = within(dialogs[dialogs.length - 1]);
    expect(overflowDialog.getByText(/Фінал/)).toBeTruthy();
    fireEvent.click(overflowDialog.getByText((t) => t.includes('Збільшити')));

    await waitFor(() => expect(paymentsApi.addReceipt).toHaveBeenCalled());
    const [, req] = vi.mocked(paymentsApi.addReceipt).mock.calls[0];
    expect(req).toMatchObject({ planPaymentId: 'pay1', amount: 7000, resolution: 'INCREASE' });
  });

  it('overpaying the LAST stage (no next) offers "збільшити" and "зарезервувати", not "перенести"', async () => {
    const only = plannedRow({ id: 'pay1', purpose: 'Фінал', amount: 5000, remaining: 5000, sortOrder: 0 });
    vi.mocked(paymentsApi.addReceipt).mockResolvedValue([receipt()]);
    renderBlock(summary([only]));

    fireEvent.click(screen.getByText('Фінал'));
    fireEvent.click(screen.getByText('Отримати платіж'));
    fireEvent.change(screen.getByPlaceholderText('0 ₴'), { target: { value: '7000' } });
    fireEvent.click(screen.getByText('Зберегти'));

    const dialogs = await screen.findAllByRole('dialog');
    const overflowDialog = within(dialogs[dialogs.length - 1]);
    expect(overflowDialog.queryByText((t) => t.includes('Перенести'))).toBeNull();
    fireEvent.click(overflowDialog.getByText((t) => /резерв/i.test(t)));

    await waitFor(() => expect(paymentsApi.addReceipt).toHaveBeenCalled());
    const [, req] = vi.mocked(paymentsApi.addReceipt).mock.calls[0];
    expect(req).toMatchObject({ planPaymentId: 'pay1', amount: 7000, resolution: 'RESERVE' });
  });

  it('a fully-received stage collapses into "✓ Отримано · 1", expandable to its own row', () => {
    const upcoming = plannedRow({ id: 'pay2', purpose: 'Фінал', amount: 3000 });
    const row = plannedRow({
      id: 'pay1', purpose: 'Аванс', received: 5000, remaining: 0, status: 'RECEIVED',
      receipts: [receipt({ id: 'r1', amount: 5000, receivedAt: '2026-08-01' })],
    });
    renderBlock(summary([row, upcoming]));

    expect(screen.queryByText('Аванс')).toBeNull(); // collapsed, not shown individually yet
    fireEvent.click(screen.getByText(/Отримано · 1/));
    expect(screen.getByText('Аванс')).toBeTruthy();
  });

  it('unplanned receipts collapse into the received group too, expandable', () => {
    const upcoming = plannedRow({ purpose: 'Фінал' });
    renderBlock(summary([upcoming], [receipt({ id: 'u1', planPaymentId: null, label: 'Продаж інструменту', displayLabel: 'Продаж інструменту', amount: 1500 })]));

    expect(screen.queryByText('Продаж інструменту')).toBeNull();
    fireEvent.click(screen.getByText(/Отримано · 1/));
    expect(screen.getByText('Продаж інструменту')).toBeTruthy();
  });

  it('when everything is received, shows "Усе сплачено" but keeps the breakdown reachable, never just a bare headline', () => {
    const row = plannedRow({ purpose: 'Аванс', received: 20000, remaining: 0, status: 'RECEIVED', receipts: [receipt({ amount: 20000 })] });
    renderBlock(summary([row]));

    expect(screen.getByText('Усе сплачено ✓')).toBeTruthy();
    // The headline is never a substitute for the itemized list — a master must be able to see
    // what actually makes up the received total (reported confusing when contractedTotal reads 0).
    expect(screen.queryByText('Аванс')).toBeNull(); // collapsed by default
    fireEvent.click(screen.getByText(/Отримано · 1/));
    expect(screen.getByText('Аванс')).toBeTruthy();
  });
  it('does not call an unplanned object «Усе сплачено» — the claim is about money, not stages', () => {
    // The master had one 5 000 ₴ advance on a 20 000 ₴ contract and no plan stages at all, so
    // `upcoming.length === 0` was true VACUOUSLY and the card announced «Усе сплачено ✓» over
    // 25 % of the contract — which reads as «the client owes nothing» (reported 2026-09-21).
    renderBlock(summary([], [receipt({ id: 'r1', planPaymentId: null, amount: 5000, label: 'Завдаток', displayLabel: 'Завдаток' })]));

    expect(screen.queryByText('Усе сплачено ✓')).toBeNull();
    // The journal is the point of this card — it stays, headline or not.
    fireEvent.click(screen.getByText(/Отримано · 1/));
    expect(screen.getByText('Завдаток')).toBeTruthy();
  });

  it('more than 5 payments collapses to a "Наступний платіж" card plus an expand toggle', () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      plannedRow({ id: `pay${i}`, purpose: `Етап ${i}`, dueDate: `2026-08-${10 + i}`, sortOrder: i }));
    renderBlock(summary(rows));

    expect(screen.getByText('Наступний платіж')).toBeTruthy();
    expect(screen.getByText(/Усі платежі \(6\)/)).toBeTruthy();
    expect(screen.queryByText('Етап 5')).toBeNull();

    fireEvent.click(screen.getByText(/Усі платежі \(6\)/));
    expect(screen.getByText('Етап 5')).toBeTruthy();
  });

  it('creating a new plan while another stage is over-received offers to transfer the surplus', async () => {
    const overReceived = plannedRow({ id: 'pay1', purpose: 'Аванс', amount: 5000, received: 6700, remaining: 0, status: 'RECEIVED' });
    vi.mocked(paymentsApi.add).mockResolvedValue(
      plannedRow({ id: 'pay2', purpose: 'Демонтаж', amount: 4000, received: 0, remaining: 4000, status: 'PLANNED' }),
    );
    vi.mocked(paymentsApi.transferSurplus).mockResolvedValue([overReceived, plannedRow({ id: 'pay2' })]);
    renderBlock(summary([overReceived]));

    fireEvent.click(screen.getByText('+ Платіж'));
    fireEvent.click(screen.getByText('Запланований'));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('напр. Аванс, Фінал'), { target: { value: 'Демонтаж' } });
    fireEvent.change(within(dialog).getByPlaceholderText('0 ₴'), { target: { value: '4000' } });
    fireEvent.click(within(dialog).getByText('Зберегти'));

    await waitFor(() => expect(paymentsApi.add).toHaveBeenCalled());

    const dialogs = await screen.findAllByRole('dialog');
    const hintDialog = within(dialogs[dialogs.length - 1]);
    expect(hintDialog.getByText(/Аванс/)).toBeTruthy();
    fireEvent.click(hintDialog.getByText('Так, перенести'));

    await waitFor(() => expect(paymentsApi.transferSurplus)
      .toHaveBeenCalledWith('obj1', { fromPaymentId: 'pay1', toPaymentId: 'pay2' }));
  });
});

/**
 * This card used to carry its own «Отримано X з Y ₴ · Z %» strip. The works axis rendered
 * immediately above it draws the SAME two figures against the same denominator — the backend
 * computes both from `sumIncomeCounted` and the Σ of the object's receipts — so the screen showed
 * three bars, two of which could never disagree («щось мені здається тут багато тих полосок»,
 * 2026-09-21). The axis keeps its copy: the balance line beneath it is the difference of exactly
 * those two numbers. This card is the journal — who paid, when, how much.
 *
 * The strip is gone, not moved, so the assertions that pinned its behaviour are gone too: both
 * were about the SHARED component and are already covered by `components/ProgressStrip.test.tsx`.
 */
describe('PaymentsBlock — the journal does not repeat the axis', () => {
  it('draws no progress bar of its own, whatever the numbers', () => {
    renderBlock(summary([], [receipt({ id: 'r1', planPaymentId: null, amount: 9000 })]));

    expect(screen.queryByTestId('progress-fill')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('still states the sum when nothing is signed — there is no axis figure to lean on', () => {
    // With no signed estimate the denominator is 0, so no percentage is possible anywhere. The
    // collapsed list says «✓ Отримано · 1» and no figure, so this line is the only place the
    // money on the object appears at all.
    renderBlock({
      contractedTotal: 0, received: 4000, remaining: 0, materialRefunds: 0, refundApplied: 0,
      workPaid: 4000, overpaid: 0, payments: [],
      unplannedReceipts: [receipt({ id: 'r1', planPaymentId: null, amount: 4000 })],
    });

    expect(screen.getByText(/Отримано 4 000/)).toBeTruthy();
    expect(screen.queryByTestId('progress-fill')).toBeNull();
  });
});

/**
 * The refusal has to be ON the form. Both sheets validate before they call anything, and both used
 * to report that through a toast alone — raised from inside a bottom sheet that covered it. From
 * the master's side «Зберегти» simply did nothing: «я пробую додати аванс, вводжу суму і тисну
 * зберегти, а воно просто не зберігає».
 */
describe('PaymentsBlock — a refused save says so on the field', () => {
  it('a planned payment with an amount but no purpose names the empty field and calls nothing', () => {
    renderBlock(summary());

    fireEvent.click(screen.getByText('+ Платіж'));
    fireEvent.click(screen.getByText('Запланований'));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('0 ₴'), { target: { value: '5000' } });
    fireEvent.click(within(dialog).getByText('Зберегти'));

    expect(paymentsApi.add).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Вкажіть призначення')).toBeTruthy();
    // And it clears as soon as he fills it in — a red field that stays red reads as broken.
    fireEvent.change(within(dialog).getByPlaceholderText('напр. Аванс, Фінал'), { target: { value: 'Аванс' } });
    expect(within(dialog).queryByText('Вкажіть призначення')).toBeNull();
  });

  it('a planned payment with a purpose but no amount names the empty amount', () => {
    renderBlock(summary());

    fireEvent.click(screen.getByText('+ Платіж'));
    fireEvent.click(screen.getByText('Запланований'));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('напр. Аванс, Фінал'), { target: { value: 'Аванс' } });
    fireEvent.click(within(dialog).getByText('Зберегти'));

    expect(paymentsApi.add).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Вкажіть суму')).toBeTruthy();
  });

  it('an advance on an object with no stages yet names the empty «Назва» — the first refusal a master meets', () => {
    renderBlock(summary());

    fireEvent.click(screen.getByText('+ Платіж'));
    fireEvent.click(screen.getByText('Вже отримано'));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('0 ₴'), { target: { value: '3000' } });
    fireEvent.click(within(dialog).getByText('Зберегти'));

    expect(paymentsApi.addReceipt).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Вкажіть назву')).toBeTruthy();
  });

  it('a name colliding with a planned stage says THAT, not "вкажіть назву"', () => {
    renderBlock(summary([plannedRow({ purpose: 'Аванс' })]));

    fireEvent.click(screen.getByText('+ Платіж'));
    fireEvent.click(screen.getByText('Вже отримано'));

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByText('Своє'));
    fireEvent.change(within(dialog).getByPlaceholderText('напр. Завдаток, продаж інструменту'), { target: { value: 'аванс' } });
    fireEvent.change(within(dialog).getByPlaceholderText('0 ₴'), { target: { value: '1000' } });
    fireEvent.click(within(dialog).getByText('Зберегти'));

    expect(paymentsApi.addReceipt).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/вже використовується/)).toBeTruthy();
  });
});

describe('PaymentsBlock — an object with nothing signed', () => {
  const nothing: PaymentsSummaryResponse = {
    contractedTotal: 0, received: 0, remaining: 0, materialRefunds: 0, refundApplied: 0,
    workPaid: 0, overpaid: 0, payments: [], unplannedReceipts: [],
  };

  it('keeps «+ Платіж» and drops only the figures that need a contract', () => {
    renderBlock(nothing);

    expect(screen.getByText('+ Платіж')).toBeTruthy();
    expect(screen.getByText(/Ще нічого не записано/)).toBeTruthy();
    // A percent over a zero denominator says nothing, and there is no contract to split.
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.queryByText('Розбити на частки')).toBeNull();
  });

  it('still states money that landed before any estimate was signed', () => {
    renderBlock({
      ...nothing,
      received: 4000,
      unplannedReceipts: [receipt({ id: 'u1', planPaymentId: null, label: 'Завдаток', displayLabel: 'Завдаток', amount: 4000 })],
    });

    // The collapsed history row only carries a count, so without this line the figure is nowhere.
    expect(screen.getByText(/4\s?000/)).toBeTruthy();
    expect(screen.queryByText(/Ще нічого не записано/)).toBeNull();
  });
});

/**
 * Review B-65. Money the client hands back for material is his OWN money returning — it buys no
 * work — so the card may not count it against the contract, and «Усе сплачено» may not be said
 * while a till receipt is still unreimbursed. Both halves have to be VISIBLE: a figure that moves
 * for a reason the screen does not name reads as our arithmetic slipping.
 */
describe('PaymentsBlock — material coming back is not payment for work (B-65)', () => {
  it('does not let a refund pay down the contract, and says why «Прийшло» is higher', () => {
    const back = receipt({ id: 'r1', planPaymentId: null, amount: 2000, label: 'Повернув за плитку',
      displayLabel: 'Повернув за плитку', materialRefund: true });
    renderBlock(summary([], [back]), 0);

    // 2 000 arrived and NOTHING was paid off the 20 000 contract.
    expect(screen.queryByText('Усе сплачено ✓')).toBeNull();
    expect(screen.getByText(/повернення за матеріал/)).toBeTruthy();
  });

  it('refuses «Усе сплачено» while a till receipt is still unreimbursed, and names what is left', () => {
    // The works side is settled to the hryvnia, but the master is still 4 200 ₴ out of pocket for
    // material. «Усе сплачено» there is simply false, and it is the line he reads to decide
    // whether to chase the client.
    const row = plannedRow({ purpose: 'Аванс', received: 20000, remaining: 0, status: 'RECEIVED',
      receipts: [receipt({ amount: 20000 })] });
    renderBlock(summary([row]), 4200);

    expect(screen.queryByText('Усе сплачено ✓')).toBeNull();
    expect(screen.getByText(/за матеріал ще/)).toBeTruthy();
  });

  it('says «Усе сплачено» once BOTH axes are at zero', () => {
    const row = plannedRow({ purpose: 'Аванс', received: 20000, remaining: 0, status: 'RECEIVED',
      receipts: [receipt({ amount: 20000 })] });
    renderBlock(summary([row]), 0);

    expect(screen.getByText('Усе сплачено ✓')).toBeTruthy();
  });

  it('shows an overpayment instead of swallowing it — `remaining` is floored at zero', () => {
    const row = plannedRow({ purpose: 'Аванс', received: 23000, remaining: 0, status: 'RECEIVED',
      receipts: [receipt({ amount: 23000 })] });
    renderBlock(summary([row]), 0);

    expect(screen.getByText(/Переплата/)).toBeTruthy();
  });

  it('asks «це повернення за матеріал?» only where there IS something to reimburse', () => {
    renderBlock(summary(), 0);

    fireEvent.click(screen.getByText('+ Платіж'));
    fireEvent.click(screen.getByText('Вже отримано'));

    // On an object with no till receipts the question has no true answer — it is pure noise.
    expect(within(screen.getByRole('dialog')).queryByRole('checkbox')).toBeNull();
  });

  it('sends the tick with the receipt, so the object can do the split at all', async () => {
    vi.mocked(paymentsApi.addReceipt).mockResolvedValue([]);
    renderBlock(summary(), 4200);

    fireEvent.click(screen.getByText('+ Платіж'));
    fireEvent.click(screen.getByText('Вже отримано'));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('0 ₴'), { target: { value: '2000' } });
    fireEvent.change(within(dialog).getByPlaceholderText(/Завдаток/), { target: { value: 'За плитку' } });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByText('Зберегти'));

    await waitFor(() => expect(paymentsApi.addReceipt).toHaveBeenCalled());
    expect(vi.mocked(paymentsApi.addReceipt).mock.calls[0][1]).toMatchObject({
      amount: 2000, materialRefund: true,
    });
  });
});
