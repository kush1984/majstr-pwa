import Dexie, { type Table } from 'dexie';
import type { OutboxOp } from './types.ts';

/**
 * IndexedDB store for the outbox (via Dexie). Separate DB from the persisted query cache — this
 * one holds unsynced WRITES (authored offline), the other holds READ cache. `++seq` is the
 * insertion order the replay follows. Dexie opens lazily (first query), so importing this module
 * never touches IndexedDB — safe in a test env until a query actually runs.
 */
class OutboxDB extends Dexie {
  ops!: Table<OutboxOp, number>;

  constructor() {
    super('majstr-outbox');
    this.version(1).stores({ ops: '++seq, entityId, entity, status' });
  }
}

export const outboxDb = new OutboxDB();
