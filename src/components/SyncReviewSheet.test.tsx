import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { SyncReviewSheet } from './SyncReviewSheet.tsx';
import { useBlockedOps } from '@/lib/useOnline.ts';
import type { OutboxOp } from '@/lib/outbox/types.ts';

vi.mock('@/lib/useOnline.ts', async (orig) => ({
  ...(await orig<typeof import('@/lib/useOnline.ts')>()),
  useBlockedOps: vi.fn((): OutboxOp[] => []),
}));
vi.mock('@/lib/outbox/outbox.ts', () => ({
  retryBlockedOps: vi.fn(() => Promise.resolve()),
  dropBlockedOps: vi.fn(() => Promise.resolve()),
}));

function op(over: Partial<OutboxOp> = {}): OutboxOp {
  return {
    seq: 1, entityId: 'e1', entity: 'actReceipt', type: 'create',
    payload: { label: 'Епіцентр' }, deps: [], status: 'blocked', blockReason: 'other',
    attempts: 1, createdAt: 0, ...over,
  };
}

function renderSheet() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(<SyncReviewSheet open onClose={() => {}} />, { wrapper });
}

beforeEach(() => vi.clearAllMocks());

describe('SyncReviewSheet', () => {
  it('prints the server’s own refusal per row, not just «сервер не прийняв»', () => {
    // Which change was refused, and why, is the whole decision the master is here to make. The
    // shipping case: a receipt queued against an act that was signed while the phone had no signal.
    vi.mocked(useBlockedOps).mockReturnValue([
      op({ lastError: 'Акт підписано — редагувати не можна' }),
    ]);

    renderSheet();

    expect(screen.getByText('Чек до акта')).toBeTruthy(); // the entity label, composed at runtime
    expect(screen.getByText('Епіцентр')).toBeTruthy();
    expect(screen.getByText('Акт підписано — редагувати не можна')).toBeTruthy();
  });

  it('says «спроби вичерпано» instead when nobody refused anything', () => {
    // A stuck op ran out of retries; naming it a rejection would be a lie, and its lastError is a
    // transport message the master can do nothing with.
    vi.mocked(useBlockedOps).mockReturnValue([
      op({ blockReason: 'stuck', lastError: 'Network Error' }),
    ]);

    renderSheet();

    expect(screen.getByText(/спроби вичерпано/)).toBeTruthy();
    expect(screen.queryByText('Network Error')).toBeNull();
  });
});
