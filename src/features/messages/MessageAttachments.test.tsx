import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@/lib/i18n.ts';
import { MessageAttachments } from './MessageAttachments.tsx';
import { messagesApi } from '@/api/messages.ts';
import { toast } from '@/hooks/useToast.ts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MessageFileView } from '@/api/types.ts';

/**
 * Attachments on a message.
 *
 * <p>The behaviour worth pinning is that nothing is fetched until asked for. Rendering thumbnails
 * eagerly would download every photo on every object the master opens, on mobile data, to show
 * something they mostly do not need — so the row is a name and a size until tapped.</p>
 */
vi.mock('@/api/messages.ts', () => ({
  messagesApi: { fetchFileUrl: vi.fn() },
}));
vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const pdf: MessageFileView = {
  id: 'f1', name: 'Рахунок №7.pdf', contentType: 'application/pdf',
  sizeBytes: 2 * 1024 * 1024, isImage: false, deleteAfter: null,
};
const photo: MessageFileView = {
  id: 'f2', name: 'Стіна.jpg', contentType: 'image/jpeg', sizeBytes: 350 * 1024, isImage: true,
  deleteAfter: null,
};

const openSpy = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(messagesApi.fetchFileUrl).mockResolvedValue('blob:fake');
  vi.stubGlobal('open', openSpy);
  // jsdom implements neither of these.
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
});

const renderList = (files: MessageFileView[]) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MessageAttachments projectId="p1" messageId="m1" files={files} />
    </QueryClientProvider>,
  );
};

describe('MessageAttachments', () => {
  it('lists a file by name and size without fetching it', () => {
    renderList([pdf, photo]);

    expect(screen.getByText('Рахунок №7.pdf')).toBeTruthy();
    expect(screen.getByText('2.0 МБ')).toBeTruthy();
    expect(screen.getByText('350 КБ')).toBeTruthy();
    expect(messagesApi.fetchFileUrl).not.toHaveBeenCalled();
  });

  it('renders nothing at all when a message has no attachments', () => {
    const { container } = renderList([]);

    expect(container.textContent).toBe('');
  });

  it('fetches a photo on tap and shows it, rather than handing it to the browser', async () => {
    renderList([photo]);

    fireEvent.click(screen.getByRole('button', { name: /Стіна\.jpg/ }));

    await waitFor(() => expect(messagesApi.fetchFileUrl).toHaveBeenCalledWith('p1', 'm1', 'f2'));
    const img = await screen.findByRole('img', { name: 'Стіна.jpg' });
    expect(img.getAttribute('src')).toBe('blob:fake');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('hands a PDF to the browser instead of trying to preview it', async () => {
    renderList([pdf]);

    fireEvent.click(screen.getByRole('button', { name: /Рахунок/ }));

    await waitFor(() => expect(openSpy).toHaveBeenCalled());
    // noopener: without it the new context gets a handle back to the app's window.
    expect(openSpy.mock.calls[0][2]).toContain('noopener');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('says so when the file cannot be fetched', async () => {
    // A file the retention sweep already removed lands here, and silence would look like a dead button.
    vi.mocked(messagesApi.fetchFileUrl).mockRejectedValue(new Error('404'));
    renderList([pdf]);

    fireEvent.click(screen.getByRole('button', { name: /Рахунок/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it('names an unnamed attachment rather than showing a blank row', () => {
    renderList([{ ...pdf, name: null }]);

    expect(screen.getByText('Вкладення')).toBeTruthy();
  });

  it('revokes the object URLs it created when it goes away', async () => {
    // Every fetched blob is held by the browser until revoked; a master opening a dozen photos over a
    // session would otherwise keep all of them in memory.
    const { unmount } = renderList([photo]);
    fireEvent.click(screen.getByRole('button', { name: /Стіна/ }));
    await waitFor(() => expect(messagesApi.fetchFileUrl).toHaveBeenCalled());

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('says when a file is due to be deleted, and how to keep it', () => {
    // The six-month sweep warned about this one. The row is the only place the master will see it if
    // the notification was missed.
    renderList([{ ...pdf, deleteAfter: '2026-08-12T03:30:00Z' }]);

    // The app's own date format: day and month, no year — the deadline is always within a fortnight.
    expect(screen.getByText(/12 серпня/)).toBeTruthy();
    expect(screen.getByText(/відкрийте, щоб зберегти/i)).toBeTruthy();
  });

  it('shows no such warning on a file that is not due', () => {
    renderList([pdf]);

    expect(screen.queryByText(/буде видалено/)).toBeNull();
  });
});
