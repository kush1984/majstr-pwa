/**
 * The outbox — offline-authored mutations queued locally (IndexedDB via Dexie) and replayed to
 * the server when the network returns (Phase 1 of offline-first). Entity-agnostic: each entity
 * registers a handler that performs the real network call; the engine owns ordering, retry and
 * status. Replay is SAFE only because the backend accepts client-provided UUIDs and creates are
 * idempotent (a replayed create never duplicates) — see docs/iteration-offline-first.md.
 */

export type OutboxOpType = 'create' | 'update' | 'delete';

export interface OutboxOp {
  /** Auto-increment insertion order (Dexie primary key) — replay follows it. */
  seq?: number;
  /**
   * Stable id of the ENTITY this op targets — a client-generated UUID for a create, the
   * entity's id for update/delete. Doubles as the idempotency key on replay, and as the handle
   * other ops name in their {@link deps}.
   */
  entityId: string;
  /** Which registered handler runs this op, e.g. 'client' | 'project' | 'estimate'. */
  entity: string;
  type: OutboxOpType;
  /** The request body to send (shape is the handler's concern). */
  payload: unknown;
  /** entityIds this op must run AFTER (an estimate depends on its object, etc.). */
  deps: string[];
  /**
   * pending = will (re)try; failed = last try failed transiently, retry next flush; blocked = the
   * server permanently rejected it (a 4xx — e.g. over the FREE limit), needs a user decision, NOT
   * retried automatically.
   */
  status: 'pending' | 'failed' | 'blocked';
  /** Why a `blocked` op is blocked: `limit` → offer PRO; `other` → a different permanent rejection. */
  blockReason?: 'limit' | 'other';
  attempts: number;
  lastError?: string;
  createdAt: number;
}

/** New-op input — the engine fills seq/status/attempts/createdAt. */
export type NewOutboxOp = Omit<OutboxOp, 'seq' | 'status' | 'attempts' | 'createdAt'> &
  Partial<Pick<OutboxOp, 'createdAt'>>;

/**
 * Performs the real network call for one queued op. Resolve = success (the op is removed);
 * throw = failure (the op stays queued as `failed` and is retried on the next flush; ops that
 * depend on it wait).
 */
export type OutboxHandler = (op: OutboxOp) => Promise<void>;
