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
    amount: 2000, receivedAt: '2026-08-01', ...overrides,
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
  return { contractedTotal: 20000, received, remaining: 20000 - received, payments, unplannedReceipts };
}

function renderBlock(s: PaymentsSummaryResponse) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<PaymentsBlock objectId="obj1" summary={s} />, { wrapper });
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

  it('a stage with receipt history shows its partial payments in the timeline', () => {
    const row = plannedRow({
      received: 200, remaining: 4800, status: 'PARTIAL',
      receipts: [receipt({ id: 'r1', amount: 200, receivedAt: '2026-08-01' })],
    });
    renderBlock(summary([row]));

    expect(screen.getByText('＋200 ₴')).toBeTruthy();
  });

  it('unplanned receipts render as their own timeline nodes', () => {
    renderBlock(summary([], [receipt({ id: 'u1', planPaymentId: null, label: 'Продаж інструменту', displayLabel: 'Продаж інструменту', amount: 1500 })]));

    expect(screen.getByText('Продаж інструменту')).toBeTruthy();
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
