import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { OfflineNotCached } from './OfflineNotCached.tsx';
import { ErrorState } from './ErrorState.tsx';
import i18n from '@/lib/i18n.ts';

/**
 * The third state: offline with nothing cached. These pin what the master is told — and, just as
 * importantly, what they are NOT told, because both of the old messages were false here.
 */
const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o ?? {});

describe('OfflineNotCached', () => {
  it('names the data and says how to make it work offline', () => {
    render(<OfflineNotCached what="Каталог" />);
    expect(screen.getByText(t('offline.notCachedNamed', { what: 'Каталог' }))).toBeTruthy();
    // The actionable half — without it this is just another dead end.
    expect(screen.getByText(new RegExp(t('offline.notCachedHow')))).toBeTruthy();
    // A retry cannot succeed with no connection, so none is offered.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('falls back to unnamed copy', () => {
    render(<OfflineNotCached />);
    expect(screen.getByText(t('offline.notCachedTitle'))).toBeTruthy();
  });

  it('compact variant fits inline and still carries the instruction', () => {
    render(<OfflineNotCached compact what="Клієнти" />);
    const text = screen.getByText(/Клієнти/).textContent ?? '';
    expect(text).toContain(t('offline.notCachedHow'));
    // The prefetch sentence is dropped in the compact slot — it does not fit in a sheet.
    expect(text).not.toContain(t('offline.notCachedPrefetch'));
  });
});

describe('ErrorState offline branch', () => {
  beforeEach(() => onlineManager.setOnline(true));

  /** A fetch that never reached the server: no HTTP status. */
  const networkErr = Object.assign(new Error('Network Error'), {
    isAxiosError: true, response: undefined,
  });

  it('offline: stops blaming the server and explains the cache instead', () => {
    onlineManager.setOnline(false);
    render(<ErrorState error={networkErr} what="Каталог" onRetry={() => {}} />);

    expect(screen.getByText(t('offline.notCachedNamed', { what: 'Каталог' }))).toBeTruthy();
    // The old copy said the SERVICE was down and offered a retry. Both were wrong offline.
    expect(screen.queryByText(t('errors.unavailableTitle'))).toBeNull();
    expect(screen.queryByText(t('common.retry'))).toBeNull();
  });

  it('online: a real outage keeps the retry', () => {
    render(<ErrorState error={networkErr} onRetry={() => {}} />);
    expect(screen.getByText(t('errors.unavailableTitle'))).toBeTruthy();
    expect(screen.getByText(t('common.retry'))).toBeTruthy();
  });

  it('offline but the server DID answer: keep the server message', () => {
    onlineManager.setOnline(false);
    const serverErr = Object.assign(new Error('nope'), {
      isAxiosError: true, response: { status: 500, data: {} },
    });
    render(<ErrorState error={serverErr} onRetry={() => {}} />);

    // A 500 that arrived before the signal dropped is a real failure, not a caching gap —
    // telling the master to "open it once online" would send them chasing the wrong problem.
    expect(screen.getByText(t('errors.unavailableTitle'))).toBeTruthy();
    expect(screen.queryByText(t('offline.notCachedTitle'))).toBeNull();
  });
});
