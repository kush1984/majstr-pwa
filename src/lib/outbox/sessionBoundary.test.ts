import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { AxiosError, type AxiosResponse } from 'axios';
import {
  clearOutbox, enqueue, flushOutbox, getSyncStatus, kickOutboxSync, listOutbox, outboxCount,
  registerOutboxHandler, setOutboxErrorClassifier, startOutboxSync,
} from './outbox.ts';
import { initOutbox } from './init.ts';
import type { NewOutboxOp } from './types.ts';
import { clientsApi } from '@/api/clients.ts';
import { tokens } from '@/lib/tokens.ts';
import { aSessionToken } from '@/test/factories.ts';

/**
 * The interceptor reads the token at request time, so an op replayed under the wrong session is an
 * ordinary create landing in somebody else's account: one master's client and money, on a phone a
 * crew shares. And a replay with no session earns a 401 whose forced login pulls a visitor off the
 * page they were on, while the attempt it burned walks the op to `stuck`.
 */
const asMaster = (id: string) => tokens.set(aSessionToken(id), 'r');
const client = (entityId: string): NewOutboxOp =>
  ({ entityId, entity: 'client', type: 'create', payload: {}, deps: [] });

let sent: string[];

beforeEach(async () => {
  asMaster('master-a');
  await clearOutbox();
  setOutboxErrorClassifier(() => 'retry');
  sent = [];
  registerOutboxHandler('client', async (op) => { sent.push(op.entityId); });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the replay', () => {
  it('sends nothing while nobody is signed in, and the op keeps its attempts', async () => {
    await enqueue(client('c1'));
    tokens.clear();

    expect(await flushOutbox()).toEqual({ synced: 0, failed: 0, blocked: 0 });

    expect(sent).toEqual([]);
    expect((await listOutbox())[0]).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('never sends another master\'s op, whatever path let it stay in the queue', async () => {
    await enqueue(client('from-a'));
    asMaster('master-b');
    await enqueue(client('from-b'));

    const result = await flushOutbox();

    expect(sent).toEqual(['from-b']);
    expect(result.synced).toBe(1);
    expect((await listOutbox()).map((o) => o.entityId)).toEqual(['from-a']); // left, not destroyed
  });

  it('never sends an op with no owner: it cannot be attributed to the one signed in', async () => {
    tokens.clear();
    await enqueue(client('unstamped'));
    asMaster('master-a');

    await flushOutbox();

    expect(sent).toEqual([]);
    expect(await outboxCount()).toBe(1);
  });

  it('stops the moment the session changes under it', async () => {
    registerOutboxHandler('client', async (op) => {
      sent.push(op.entityId);
      asMaster('master-b'); // another tab logged in while the first request was in the air
    });
    await enqueue(client('c1'));
    await enqueue(client('c2'));

    await flushOutbox();

    expect(sent).toEqual(['c1']);
    expect((await listOutbox()).map((o) => o.entityId)).toEqual(['c2']);
  });

  it('a dead session stops the pass and costs the op no attempt', async () => {
    setOutboxErrorClassifier(() => 'auth');
    registerOutboxHandler('client', async (op) => {
      sent.push(op.entityId);
      throw new Error('401');
    });
    await enqueue(client('c1'));
    await enqueue(client('c2'));

    const result = await flushOutbox();

    expect(sent).toEqual(['c1']);
    expect(result).toEqual({ synced: 0, failed: 1, blocked: 0 });
    for (const op of await listOutbox()) {
      expect(op).toMatchObject({ status: 'pending', attempts: 0 });
    }
  });

  it('classifies a real 401 as the dead session, and a 403 as it always was', async () => {
    const http = (status: number) => new AxiosError('refused', String(status), undefined, undefined,
      { status, data: {} } as AxiosResponse);
    const stop = initOutbox(new QueryClient());
    const create = vi.spyOn(clientsApi, 'create').mockRejectedValueOnce(http(401));
    await enqueue(client('c1'));

    await flushOutbox();
    expect((await listOutbox())[0]).toMatchObject({ status: 'pending', attempts: 0 });

    create.mockRejectedValueOnce(http(403));
    await flushOutbox();
    expect((await listOutbox())[0]).toMatchObject({ status: 'failed', attempts: 1 });
    stop();
  });
});

describe('the sync status', () => {
  it('does not count another master\'s leftovers as work in progress', async () => {
    // A `runnable` that can never reach 0 shuts the focus refetch and the post-flush refetch app-wide.
    await enqueue(client('from-a'));
    asMaster('master-b');

    await flushOutbox();

    expect(getSyncStatus()).toMatchObject({ pending: 0, blocked: 0, runnable: 0 });
    expect(await outboxCount()).toBe(1);
  });
});

describe('startOutboxSync', () => {
  it('stays quiet without a session, and one kick after the login lands the restored work', async () => {
    await enqueue(client('c1'));
    tokens.clear();
    const onFlush = vi.fn();

    const stop = startOutboxSync(onFlush);
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(onFlush).not.toHaveBeenCalled();

    asMaster('master-a');
    kickOutboxSync();

    await vi.waitFor(() => { expect(sent).toEqual(['c1']); });
    stop();
  });
});
