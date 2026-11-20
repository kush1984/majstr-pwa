import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { PaymentNotices } from './PaymentNotices.tsx';
import { messagesApi } from '@/api/messages.ts';
import type { MessageView } from '@/api/types.ts';

/**
 * A client's «Я оплатив» the receipt check could not settle waits in the object's money (V217), not in
 * a notification: the master answers it there, and only the ones still waiting are shown.
 */
vi.mock('@/api/messages.ts', () => ({
  messagesApi: {
    listForProject: vi.fn(), confirmPayment: vi.fn(), dismissPayment: vi.fn(), fetchFileUrl: vi.fn(),
  },
}));
vi.mock('@/hooks/useToast.ts', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const waiting: MessageView = {
  id: 'n1', authorName: 'Олена', authorPhone: null, message: 'Оплату здійснено', estimateName: null,
  isRead: false, createdAt: '2026-11-19T10:00:00Z', files: [], kind: 'PAYMENT', paymentAmount: 10000,
  paymentStatus: 'PENDING', paymentNote: 'У квитанції 9 000 ₴, а клієнт вказав 10 000 ₴.', paymentRecorded: false,
};

function renderNotices(messages: MessageView[], canWrite = true) {
  vi.mocked(messagesApi.listForProject).mockResolvedValue(messages);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return render(<PaymentNotices objectId="p1" canWrite={canWrite} />, { wrapper });
}

beforeEach(() => vi.clearAllMocks());

describe('PaymentNotices', () => {
  it('asks about a waiting notice, with the reason it could not be verified', async () => {
    renderNotices([waiting]);

    expect(await screen.findByText(/Клієнт повідомив про оплату 10/)).toBeTruthy();
    expect(screen.getByText(/У квитанції 9 000 ₴, а клієнт вказав 10 000 ₴\./)).toBeTruthy();
  });

  it('«Кошти прийшли» confirms, «Не надійшло» dismisses', async () => {
    vi.mocked(messagesApi.confirmPayment).mockResolvedValue({ ...waiting, paymentStatus: 'RECORDED', paymentRecorded: true });
    vi.mocked(messagesApi.dismissPayment).mockResolvedValue({ ...waiting, id: 'n2', paymentStatus: 'DISMISSED' });
    renderNotices([waiting, { ...waiting, id: 'n2' }]);

    const arrived = await screen.findAllByRole('button', { name: 'Кошти прийшли' });
    fireEvent.click(arrived[0]);
    await waitFor(() => expect(messagesApi.confirmPayment).toHaveBeenCalledWith('p1', 'n1'));
    // The answered one leaves the block — the list is written from the server's answer.
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Кошти прийшли' })).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Не надійшло' }));
    await waitFor(() => expect(messagesApi.dismissPayment).toHaveBeenCalledWith('p1', 'n2'));
    await waitFor(() => expect(screen.queryByText(/Клієнт повідомив про оплату/)).toBeNull());
  });

  it('shows nothing when nothing waits — a recorded, dismissed or ordinary message is not a question', async () => {
    const { container } = renderNotices([
      { ...waiting, paymentStatus: 'RECORDED', paymentRecorded: true },
      { ...waiting, id: 'n2', paymentStatus: 'DISMISSED' },
      { ...waiting, id: 'n3', kind: 'MESSAGE', paymentAmount: undefined, paymentStatus: undefined },
    ]);

    await waitFor(() => expect(messagesApi.listForProject).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('offers no answer where the master cannot write money', async () => {
    renderNotices([waiting], false);

    expect(await screen.findByText(/Клієнт повідомив про оплату/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Кошти прийшли' })).toBeNull();
  });
});
