import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLogin } from './useLogin.ts';
import { useRegister } from './useRegister.ts';
import { ME_QUERY_KEY } from './useMe.ts';
import { authApi } from '@/api/auth.ts';
import { outboxDb } from '@/lib/outbox/db.ts';
import {
  clearOutbox, enqueue, listOutbox, outboxCount, registerOutboxHandler, startOutboxSync,
} from '@/lib/outbox/outbox.ts';
import type { NewOutboxOp } from '@/lib/outbox/types.ts';
import { tokens } from '@/lib/tokens.ts';
import { toast } from '@/hooks/useToast.ts';
import type { AuthResponse, LoginRequest, RegisterRequest } from '@/api/types.ts';
import { aSessionToken, aUser } from '@/test/factories.ts';

vi.mock('@/api/auth.ts', () => ({ authApi: { login: vi.fn(), register: vi.fn() } }));
vi.mock('@/lib/sentry.ts', () => ({ setSentryUser: vi.fn() }));

const CATALOG_KEY = ['catalog', 'list', 'all'] as const;

function authFor(id: string): AuthResponse {
  return {
    accessToken: aSessionToken(id),
    refreshToken: `refresh-${id}`,
    tokenType: 'Bearer',
    expiresInSeconds: 900,
    user: aUser({ id }),
  };
}

function wrapperFor(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const queued = (entityId: string, ownerId: string): NewOutboxOp =>
  ({ entityId, entity: 'client', type: 'create', payload: {}, deps: [], ownerId });

let sent: string[];
let qc: QueryClient;

const loginAs = (id: string) => {
  vi.mocked(authApi.login).mockResolvedValue(authFor(id));
  const { result } = renderHook(() => useLogin(), { wrapper: wrapperFor(qc) });
  return result.current.mutateAsync({} as LoginRequest);
};

const registerAs = (id: string) => {
  vi.mocked(authApi.register).mockResolvedValue(authFor(id));
  const { result } = renderHook(() => useRegister(), { wrapper: wrapperFor(qc) });
  return result.current.mutateAsync({} as RegisterRequest);
};

beforeEach(async () => {
  localStorage.clear();
  vi.clearAllMocks();
  await clearOutbox();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  sent = [];
  registerOutboxHandler('client', async (op) => { sent.push(op.entityId); });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  ['login', loginAs],
  ['registration', registerAs],
])('a session begun by %s', (_door, begin) => {
  it('destroys another master\'s queue without sending a byte of it', async () => {
    await enqueue(queued('from-a', 'master-a'));
    const stop = startOutboxSync();

    await begin('master-b');

    expect(await outboxCount()).toBe(0);
    expect(sent).toEqual([]);
    stop();
  });

  it('removes that queue BEFORE the new token exists', async () => {
    await enqueue(queued('from-a', 'master-a'));
    const tokenAtDelete: (string | null)[] = [];
    const bulkDelete = outboxDb.ops.bulkDelete.bind(outboxDb.ops);
    vi.spyOn(outboxDb.ops, 'bulkDelete').mockImplementation((keys) => {
      tokenAtDelete.push(tokens.getAccess());
      return bulkDelete(keys);
    });

    await begin('master-b');

    expect(tokenAtDelete).toEqual([null]);
    expect(tokens.ownerId()).toBe('master-b');
  });

  it('drops the previous account\'s cached screens and primes the new /me', async () => {
    qc.setQueryData(CATALOG_KEY, [{ id: 'a-item', name: 'Позиція майстра А' }]);

    await begin('master-b');

    expect(qc.getQueryData(CATALOG_KEY)).toBeUndefined();
    expect(qc.getQueryData(ME_QUERY_KEY)).toEqual(aUser({ id: 'master-b' }));
  });
});

describe('the same master coming back', () => {
  it('gets his own unsynced work back, says so, and sends it at once', async () => {
    await enqueue(queued('mine', 'master-a'));
    const info = vi.spyOn(toast, 'info');
    const stop = startOutboxSync();

    await loginAs('master-a');

    expect(info).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => { expect(sent).toEqual(['mine']); });
    stop();
  });
});

describe('a wedged IndexedDB', () => {
  it('does not hold the login, and the replay still refuses what it could not delete', async () => {
    await enqueue(queued('from-a', 'master-a'));
    vi.spyOn(outboxDb.ops, 'toArray').mockImplementation(() => new Promise(() => {}) as never);

    await loginAs('master-b');

    expect(tokens.ownerId()).toBe('master-b');
    vi.restoreAllMocks();
    expect((await listOutbox()).map((o) => o.entityId)).toEqual(['from-a']);
    expect(sent).toEqual([]);
  });
});
