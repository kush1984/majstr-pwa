/**
 * A client-generated UUID. Used to give offline-authored entities a STABLE id at creation time
 * (the same id the server persists), so a queued create replays idempotently and children can
 * reference the parent before it has synced — no temp-id remapping. `crypto.randomUUID` when
 * available (secure contexts, modern browsers, Node), with a plain fallback for anything else.
 */
export function newUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
