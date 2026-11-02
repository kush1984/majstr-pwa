import { newUuid } from '@/lib/uuid.ts';

const unanswered = new Map<string, string>();

/**
 * Sends a write that creates something but has no id of its own, under an id that survives a retry
 * (P-78). A client timeout does not stop the server: it stored the photo or the estimate, the master
 * saw a failure and tried again, and now there are two.
 *
 * The id is keyed on what is being sent, so a retry needs nothing from the screen that made it, and it
 * is forgotten once an answer arrives, so doing the same thing on purpose a second time is a new
 * submission. The server replays its first answer to a repeated id (`IdempotentWriteFilter`).
 */
export async function sendOnce<T>(
  fingerprint: string,
  send: (headers: { 'X-Entity-Uuid': string }) => Promise<T>,
): Promise<T> {
  const id = unanswered.get(fingerprint) ?? newUuid();
  unanswered.set(fingerprint, id);
  const result = await send({ 'X-Entity-Uuid': id });
  unanswered.delete(fingerprint);
  return result;
}
