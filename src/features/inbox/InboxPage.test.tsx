import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import type { InboxEntryView } from '@/api/types.ts';

const me = vi.hoisted(() => ({ data: { plan: 'FREE', emailVerified: false } }));
const entry: InboxEntryView = {
  id: 'e1', source: 'TELEGRAM', status: 'NEW', rawText: 'клей 3 мішки', createdAt: '2026-11-16T09:00:00Z',
  items: [{ id: 'i1', kind: 'SHOPPING', status: 'PENDING', text: 'клей', issue: 'OBJECT' }],
};

vi.mock('./useInbox.ts', () => ({
  useInbox: () => ({ data: [entry], isLoading: false, isError: false }),
  useTelegram: () => ({ data: { available: false, linked: false } }),
  useInboxActions: () => new Proxy({}, { get: () => ({ mutate: vi.fn(), isPending: false }) }),
}));
vi.mock('@/features/auth/useMe.ts', () => ({ useMe: () => me }));
vi.mock('@/features/projects/useProjects.ts', () => ({
  isTerminalStage: () => false,
  useProjects: () => ({
    data: [
      { id: 'p1', name: 'Бандери 12', stage: 'IN_PROGRESS' },
      { id: 'p2', name: 'Приклад: ванна', stage: 'IN_PROGRESS', sample: true },
    ],
  }),
}));
vi.mock('@/hooks/useSpeechDictation.ts', () => ({
  useSpeechDictation: () => ({ available: false, listening: false, interim: '', start: vi.fn(), stop: vi.fn() }),
}));

import { InboxPage } from './InboxPage.tsx';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
  );
  return render(<InboxPage />, { wrapper });
}

describe('InboxPage (majster-bot review)', () => {
  beforeEach(() => {
    me.data = { plan: 'FREE', emailVerified: false };
  });

  it('says a FREE account must verify its email before notes are sorted', () => {
    renderPage();
    expect(screen.getByText(/підтвердіть пошту/)).toBeTruthy();
  });

  it('says nothing about email once it is verified', () => {
    me.data = { plan: 'FREE', emailVerified: true };
    renderPage();
    expect(screen.queryByText(/підтвердіть пошту/)).toBeNull();
  });

  it('never offers the training sample as an object', () => {
    renderPage();
    expect(screen.getByRole('option', { name: 'Бандери 12' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Приклад: ванна' })).toBeNull();
  });
});
