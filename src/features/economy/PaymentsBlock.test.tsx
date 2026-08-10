import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { PaymentsBlock } from './PaymentsBlock.tsx';
import { paymentsApi } from '@/api/payments.ts';
import type { PaymentsSummaryResponse, ProjectPaymentResponse } from '@/api/types.ts';

vi.mock('@/api/payments.ts', () => ({
  paymentsApi: {
    add: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    previewSplit: vi.fn(),
    commitSplit: vi.fn(),
  },
}));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

function plannedRow(overrides: Partial<ProjectPaymentResponse> = {}): ProjectPaymentResponse {
  return {
    id: 'pay1', amount: 5000, dueDate: '2026-08-15', nextStage: 'Чорнові роботи',
    purpose: 'Аванс', paidAmount: null, paidAt: null, status: 'PLANNED', sortOrder: 0,
    ...overrides,
  };
}

function summary(payments: ProjectPaymentResponse[] = []): PaymentsSummaryResponse {
  return { contractedTotal: 20000, received: 0, remaining: 20000, payments };
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

describe('PaymentsBlock — plan vs fact', () => {
  it('"+ Платіж" offers a choice between planned and already-received', () => {
    renderBlock(summary());

    fireEvent.click(screen.getByText('+ Платіж'));

    expect(screen.getByText('Запланований')).toBeTruthy();
    expect(screen.getByText('Вже отримано')).toBeTruthy();
  });

  it('the planned form has no "Отримано" field at all, and creates with paidAmount null', async () => {
    vi.mocked(paymentsApi.add).mockResolvedValue(plannedRow());
    renderBlock(summary());

    fireEvent.click(screen.getByText('+ Платіж'));
    fireEvent.click(screen.getByText('Запланований'));

    // The summary strip above always shows "Отримано" — scope to the open dialog, where the
    // planned-fields form must show no fact/paid section at all in create mode.
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText('Отримано')).toBeNull();
    fireEvent.change(within(dialog).getByPlaceholderText('напр. Аванс, Фінал'), { target: { value: 'Аванс' } });
    fireEvent.change(within(dialog).getByPlaceholderText('0 ₴'), { target: { value: '5000' } });
    fireEvent.click(within(dialog).getByText('Зберегти'));

    await waitFor(() => expect(paymentsApi.add).toHaveBeenCalled());
    const [, req] = vi.mocked(paymentsApi.add).mock.calls[0];
    expect(req).toMatchObject({ purpose: 'Аванс', amount: 5000, paidAmount: null, paidAt: null });
  });

  it('"Вже отримано" is one step — purpose + amount + date, planned and received equal', async () => {
    vi.mocked(paymentsApi.add).mockResolvedValue(plannedRow({ paidAmount: 3000 }));
    renderBlock(summary());

    fireEvent.click(screen.getByText('+ Платіж'));
    fireEvent.click(screen.getByText('Вже отримано'));

    fireEvent.change(screen.getByPlaceholderText('напр. Аванс, Фінал'), { target: { value: 'Завдаток' } });
    fireEvent.change(screen.getByPlaceholderText('0 ₴'), { target: { value: '3000' } });
    fireEvent.click(screen.getByText('Зберегти'));

    await waitFor(() => expect(paymentsApi.add).toHaveBeenCalled());
    const [, req] = vi.mocked(paymentsApi.add).mock.calls[0];
    expect(req).toMatchObject({ purpose: 'Завдаток', amount: 3000, paidAmount: 3000 });
    expect(req.paidAt).toBeTruthy();
    expect(req.dueDate).toBeNull();
    expect(req.nextStage).toBeNull();
  });

  it('a PLANNED row offers "Позначити отриманим", which sets the fact without touching the plan', async () => {
    const row = plannedRow();
    vi.mocked(paymentsApi.update).mockResolvedValue({ ...row, paidAmount: 5000, paidAt: '2026-08-10T00:00:00Z', status: 'RECEIVED' });
    renderBlock(summary([row]));

    fireEvent.click(screen.getByText('Аванс')); // open the row's edit sheet
    expect(screen.getByText('Позначити отриманим')).toBeTruthy();
    fireEvent.click(screen.getByText('Позначити отриманим'));

    // MarkReceivedSheet defaults the amount to the planned amount.
    expect(screen.getByDisplayValue('5000')).toBeTruthy();
    fireEvent.click(screen.getByText('Зберегти'));

    await waitFor(() => expect(paymentsApi.update).toHaveBeenCalled());
    const [, , req] = vi.mocked(paymentsApi.update).mock.calls[0];
    // The planned fields survive untouched — update() is a full replace.
    expect(req).toMatchObject({ purpose: 'Аванс', amount: 5000, dueDate: '2026-08-15', nextStage: 'Чорнові роботи', paidAmount: 5000 });
    expect(req.paidAt).toBeTruthy();
  });

  it('an already-received row shows the fact summary and offers "Змінити" instead', () => {
    const row = plannedRow({ paidAmount: 5000, paidAt: '2026-08-10T00:00:00Z', status: 'RECEIVED' });
    renderBlock(summary([row]));

    fireEvent.click(screen.getByText('Аванс'));

    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByText('Позначити отриманим')).toBeNull();
    expect(dialog.getByText('Змінити')).toBeTruthy();
    expect(dialog.getByText(/Отримано/)).toBeTruthy();
  });
});
