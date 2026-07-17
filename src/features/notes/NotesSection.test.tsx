import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { NotesSection } from './NotesSection.tsx';
import { notesApi } from '@/api/notes.ts';
import type { NoteResponse } from '@/api/types.ts';

vi.mock('@/api/notes.ts', () => ({
  notesApi: { list: vi.fn(), add: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));

const note = (over: Partial<NoteResponse> = {}): NoteResponse => ({
  id: 'n1',
  title: 'Архітектор Олег',
  phone: '067 123 45 67',
  body: 'ключі в консьєржа\nстояк до 9:00',
  createdAt: '2026-07-16T10:00:00Z',
  updatedAt: '2026-07-16T10:00:00Z',
  ...over,
});

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  render(<NotesSection objectId="p1" />, { wrapper });
}

beforeEach(() => vi.clearAllMocks());

describe('NotesSection', () => {
  it('renders a note with a title and a tel: call chip (spaces stripped from the href)', async () => {
    vi.mocked(notesApi.list).mockResolvedValue([note()]);
    renderSection();

    await waitFor(() => expect(screen.getByText('Архітектор Олег')).toBeTruthy());
    // Body keeps its line breaks (pre-wrap) — the text node holds the newline.
    expect(screen.getByText(/ключі в консьєржа/)).toBeTruthy();
    const call = screen.getByRole('link', { name: /067 123 45 67/ }) as HTMLAnchorElement;
    expect(call.getAttribute('href')).toBe('tel:0671234567');
  });

  it('teaches with an example in the empty state', async () => {
    vi.mocked(notesApi.list).mockResolvedValue([]);
    renderSection();
    await waitFor(() => expect(screen.getByText(/ключі в консьєржа/)).toBeTruthy());
  });

  it('adds a note with only body (title & phone optional)', async () => {
    vi.mocked(notesApi.list).mockResolvedValue([]);
    vi.mocked(notesApi.add).mockResolvedValue(note({ id: 'n2', title: null, phone: null, body: 'просто текст' }));
    renderSection();

    await waitFor(() => expect(screen.getByRole('button', { name: '+ Нотатка' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '+ Нотатка' }));

    // Save stays disabled until the body has content.
    const save = screen.getByRole('button', { name: 'Зберегти' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText(/Текст нотатки/), { target: { value: 'ключі в консьєржа' } });
    expect((screen.getByRole('button', { name: 'Зберегти' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    await waitFor(() => expect(notesApi.add).toHaveBeenCalledTimes(1));
    expect(notesApi.add).toHaveBeenCalledWith('p1', { title: null, phone: null, body: 'ключі в консьєржа' });
  });
});
