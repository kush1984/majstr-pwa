import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { MessagesSection } from './MessagesSection.tsx';
import { messagesApi } from '@/api/messages.ts';
import type { MessageView } from '@/api/types.ts';

/**
 * The messages block on an object. Two things here are worth a test rather than a look: a message with
 * no estimate must render (that is the whole point of moving them onto the object — anything sent
 * through the master's link has none), and deleting must ask first, because a message is somebody
 * else's words and there is no undo.
 */
vi.mock('@/api/messages.ts', () => ({
  messagesApi: { listForProject: vi.fn(), markRead: vi.fn(), remove: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const fromClient: MessageView = {
  id: 'm1', authorName: 'Василь', authorPhone: '+380 67 111 22 33',
  message: 'Коли починаєте?', estimateName: 'Варіант А', isRead: true,
  createdAt: '2026-07-20T10:00:00Z',
};
const fromLink: MessageView = {
  id: 'm2', authorName: 'Постачальник', authorPhone: null,
  message: 'Рахунок у вкладенні', estimateName: null, isRead: true,
  createdAt: '2026-07-21T10:00:00Z',
};

function renderSection(messages: MessageView[]) {
  vi.mocked(messagesApi.listForProject).mockResolvedValue(messages);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return render(<MessagesSection projectId="p1" />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(messagesApi.markRead).mockResolvedValue(undefined);
  vi.mocked(messagesApi.remove).mockResolvedValue(undefined);
});

describe('MessagesSection', () => {
  it('renders a message that has no estimate', async () => {
    // Before messages moved onto the object this could not exist, and the view dereferenced the
    // estimate for its name — so this is the shape the whole migration was for.
    renderSection([fromLink]);

    expect(await screen.findByText('Рахунок у вкладенні')).toBeTruthy();
    expect(screen.getByText('Постачальник')).toBeTruthy();
    expect(screen.queryByText(/щодо/)).toBeNull();
  });

  it('names the estimate when the message came off one', async () => {
    renderSection([fromClient]);

    expect(await screen.findByText(/Варіант А/)).toBeTruthy();
  });

  it('offers a one-tap call with the spaces stripped from the href', async () => {
    // A tel: link keeps the number readable on screen but must not carry spaces into the dialler.
    renderSection([fromClient]);

    const call = await screen.findByText(/380 67 111 22 33/);
    expect(call.getAttribute('href')).toBe('tel:+380671112233');
  });

  it('asks before deleting, and only deletes on confirm', async () => {
    renderSection([fromClient]);
    await screen.findByText('Коли починаєте?');

    fireEvent.click(screen.getByRole('button', { name: /Видалити/ }));

    // The dialog names the author, so the master can see which message they are about to lose.
    expect(await screen.findByText(/Василь.*вкладення/s)).toBeTruthy();
    expect(messagesApi.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: /Видалити/ }).at(-1)!);

    await waitFor(() => expect(messagesApi.remove).toHaveBeenCalledWith('p1', 'm1'));
  });

  it('deletes nothing when the confirmation is dismissed', async () => {
    renderSection([fromClient]);
    await screen.findByText('Коли починаєте?');

    fireEvent.click(screen.getByRole('button', { name: /Видалити/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Скасувати/ }));

    await waitFor(() => expect(screen.queryByText(/вкладення/)).toBeNull());
    expect(messagesApi.remove).not.toHaveBeenCalled();
  });

  it('marks the unread ones read on open, and keeps them highlighted for this viewing', async () => {
    renderSection([{ ...fromClient, isRead: false }]);

    await waitFor(() => expect(messagesApi.markRead).toHaveBeenCalledWith('p1', 'm1'));
    // Still flagged on screen: the master needs to see which ones were new even after the badge clears.
    expect(screen.getByText('Коли починаєте?').closest('div')?.className).toContain('bg-brand-soft');
  });
});
