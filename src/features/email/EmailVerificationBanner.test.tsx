import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n.ts';
import { EmailVerificationBanner } from './EmailVerificationBanner.tsx';
import { EmailVerifyModal } from './EmailVerifyModal.tsx';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { PLAN_LIMITS_KEY } from '@/features/plan/usePlanLimits.ts';
import { aPlanLimits, aUser } from '@/test/factories.ts';

vi.mock('@/hooks/useToast.ts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

function wrapperWith(trialDays: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_QUERY_KEY, aUser({ emailVerified: false, email: 'm@example.com' }));
  qc.setQueryData(PLAN_LIMITS_KEY, aPlanLimits({ trialDays }));
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

// trialDays 0 is the server's off switch (2026-11-11): no screen names the PRO trial while it is off.
describe('the verify-email texts name the PRO trial only while it is offered', () => {
  it('banner: trial off → no mention of it', () => {
    render(<EmailVerificationBanner />, { wrapper: wrapperWith(0) });
    expect(screen.getByText(/m@example\.com/).textContent).not.toMatch(/пробн/i);
  });

  it('banner: trial on → it is named', () => {
    render(<EmailVerificationBanner />, { wrapper: wrapperWith(30) });
    expect(screen.getByText(/m@example\.com/).textContent).toMatch(/пробний PRO/);
  });

  it('modal: trial off → no mention of it', () => {
    render(<EmailVerifyModal open onClose={() => {}} />, { wrapper: wrapperWith(0) });
    expect(screen.getByText(/Viber чи Telegram/).textContent).not.toMatch(/пробн/i);
  });

  it('modal: trial on → it is named', () => {
    render(<EmailVerifyModal open onClose={() => {}} />, { wrapper: wrapperWith(30) });
    expect(screen.getByText(/Viber чи Telegram/).textContent).toMatch(/пробний PRO/);
  });
});
