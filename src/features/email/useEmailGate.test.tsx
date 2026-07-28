import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { useEmailGate } from './useEmailGate.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { authApi } from '@/api/auth.ts';
import { aUser } from '@/test/factories.ts';

/**
 * The production complaint: masters clicked the link in their mail and the app went on demanding
 * they verify their email. The link opens in the mail app's browser — a different cache — so the
 * instance they were working in kept a week-old `me` saying unverified, and every gated action
 * stayed shut while the server would have allowed it.
 */
vi.mock('@/api/auth.ts', () => ({ authApi: { me: vi.fn() } }));

function harness(seed?: (qc: QueryClient) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed?.(qc);
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return renderHook(() => useEmailGate(), { wrapper }).result;
}

beforeEach(() => {
  vi.clearAllMocks();
  onlineManager.setOnline(true);
});

describe('useEmailGate', () => {
  it('asks the server when the cache says unverified, and unblocks on the fresh answer', async () => {
    // This is the reported bug in one assertion: the cache is wrong, the server is right, and the
    // master must be let through rather than sent to verify what they already verified.
    vi.mocked(authApi.me).mockResolvedValue(aUser({ emailVerified: true }));
    const gate = harness((qc) => qc.setQueryData(ME_QUERY_KEY, aUser({ emailVerified: false })));

    await expect(gate.current()).resolves.toBe(true);
    expect(authApi.me).toHaveBeenCalledTimes(1);
  });

  it('trusts a cached true without a request', async () => {
    // Verification is one-way, so a cached `true` cannot go stale into wrongly blocking anyone —
    // and every PDF or share tap should not cost an extra round trip.
    const gate = harness((qc) => qc.setQueryData(ME_QUERY_KEY, aUser({ emailVerified: true })));

    await expect(gate.current()).resolves.toBe(true);
    expect(authApi.me).not.toHaveBeenCalled();
  });

  it('still refuses when the server also says unverified', async () => {
    vi.mocked(authApi.me).mockResolvedValue(aUser({ emailVerified: false }));
    const gate = harness((qc) => qc.setQueryData(ME_QUERY_KEY, aUser({ emailVerified: false })));

    await expect(gate.current()).resolves.toBe(false);
  });

  it('falls back to what it knows when the request fails', async () => {
    // Offline, or the backend is down. Telling a master to go verify their email because we could
    // not reach the server would be a worse answer than the one we already have.
    vi.mocked(authApi.me).mockRejectedValue(new Error('Network Error'));
    const gate = harness((qc) => qc.setQueryData(ME_QUERY_KEY, aUser({ emailVerified: false })));

    await expect(gate.current()).resolves.toBe(false);
  });

  it('asks the server when there is nothing cached at all', async () => {
    vi.mocked(authApi.me).mockResolvedValue(aUser({ emailVerified: true }));
    const gate = harness();

    await expect(gate.current()).resolves.toBe(true);
    expect(authApi.me).toHaveBeenCalledTimes(1);
  });
});
