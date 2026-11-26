/**
 * «Хочете одразу знати, коли клієнт підпише? Підключіть Telegram» — offered once, after an estimate really
 * left the app (iteration-master-contact). The moment he is waiting for the client is the one where a
 * notification is worth something to him.
 *
 * <p>Once per account, remembered on the device — the trial offer's and the help card's rule (localStorage,
 * keyed by user id). A second phone shows it once more, which is harmless and spares a column, an endpoint
 * and an outbox entity; a linked bot hides it everywhere anyway, because the host asks the server for the
 * bot's status.</p>
 */
const SEEN = (userId: string) => `majstr.telegramOfferSeen.${userId}`;

export function telegramOfferSeen(userId: string): boolean {
  try {
    return localStorage.getItem(SEEN(userId)) === '1';
  } catch {
    return false;
  }
}

export function markTelegramOfferSeen(userId: string): void {
  try {
    localStorage.setItem(SEEN(userId), '1');
  } catch {
    // Blocked storage: it may show again after the next send, which is harmless.
  }
}

type Listener = () => void;
let pending = false;
const listeners = new Set<Listener>();

/** The one host (`TelegramOfferHost`, mounted in `App`) listens; the share sheet calls {@link afterSend}. */
export const telegramOfferStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  pending(): boolean {
    return pending;
  },
  /** An estimate's link or letter really left the app. Called after the share sheet closed. */
  afterSend(): void {
    if (pending) return;
    pending = true;
    for (const l of listeners) l();
  },
  clear(): void {
    if (!pending) return;
    pending = false;
    for (const l of listeners) l();
  },
};
