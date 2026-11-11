import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { PlanEndingBanner } from './PlanEndingBanner.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { aUser } from '@/test/factories.ts';
import type { UserResponse } from '@/api/types.ts';

const NOW = Date.parse('2026-11-11T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function show(me: Partial<UserResponse>, now = NOW) {
  const qc = new QueryClient();
  qc.setQueryData(ME_QUERY_KEY, aUser(me));
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><PlanEndingBanner now={now} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const ending = (inMs: number): Partial<UserResponse> => ({
  plan: 'PRO', planExpiresAt: new Date(NOW + inMs).toISOString(), autoRenew: false, cardMask: null,
});

describe('PlanEndingBanner', () => {
  beforeEach(() => localStorage.clear());

  it('warns over the last three days of a term that ends', () => {
    show(ending(2 * DAY));
    expect(screen.getByText(/PRO закінчується/)).toBeTruthy();
    expect(screen.getByText(/Далі буде FREE/)).toBeTruthy();
  });

  it('says nothing earlier, on FREE, on a plan with no end, or one about to renew from a card', () => {
    const { unmount } = show(ending(10 * DAY));
    expect(screen.queryByTestId('plan-ending-banner')).toBeNull();
    unmount();
    show({ plan: 'FREE', planExpiresAt: null }).unmount();
    show({ plan: 'PRO', planExpiresAt: null }).unmount();
    show({ ...ending(DAY), autoRenew: true, cardMask: '4441 **** 1111' });
    expect(screen.queryByTestId('plan-ending-banner')).toBeNull();
  });

  it('a dismissal three days out does not hide the last day', () => {
    const me = ending(2 * DAY);
    const { unmount } = show(me);
    fireEvent.click(screen.getByLabelText('Закрити'));
    expect(screen.queryByTestId('plan-ending-banner')).toBeNull();
    unmount();

    show(me, NOW + 1.5 * DAY); // half a day left — the last stage
    expect(screen.getByTestId('plan-ending-banner')).toBeTruthy();
  });
});
