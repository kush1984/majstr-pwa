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
    // v2 adds `ownerId` so the queue can survive a logout and be handed back to the same
    // master. Rows written by v1 carry no owner; they are deliberately left un-stamped rather
    // than guessed at — claiming them for whoever logs in next would risk replaying one
    // master's work into another's account. `discardForeignOps` drops them, which matches the
    // old behaviour (everything was wiped on logout) so nobody is worse off than before.
    this.version(2).stores({ ops: '++seq, entityId, entity, status, ownerId' });
  }
}

export const outboxDb = new OutboxDB();
