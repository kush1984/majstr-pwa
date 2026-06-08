import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { captureException } from '@/lib/sentry.ts';

// Spy on the Sentry forwarder without loading the real SDK.
vi.mock('@/lib/sentry.ts', () => ({
  captureException: vi.fn(),
  initSentry: vi.fn(),
  setSentryUser: vi.fn(),
}));

function Boom(): never {
  throw new Error('kaboom');
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React logs caught render errors to console.error — silence the noise.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('all good')).toBeTruthy();
  });

  it('shows the friendly fallback (not a blank screen) and reports to Sentry', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    // Friendly UA copy + a reload affordance — never a white screen.
    expect(screen.getByText('Щось пішло не так')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Оновити сторінку' })).toBeTruthy();
    // We hear about it first.
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('supports a custom per-surface fallback', () => {
    render(
      <ErrorBoundary fallback={() => <div>портал недоступний</div>}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('портал недоступний')).toBeTruthy();
  });
});
