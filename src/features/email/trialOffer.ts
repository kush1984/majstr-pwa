import type { UserResponse } from '@/api/types.ts';

/**
 * «Підтвердіть пошту — і зможете ввімкнути N днів PRO» — offered once, right after the master's first send
 * (share-without-verification, 2026-11-09). Sharing no longer asks for a verified email, so the moment
 * a link has really left is the one where verifying is worth something to him: the PRO trial, and
 * the letter to the client that only a verified account may send.
 *
 * <p>Who is offered it comes from the SERVER's `me` (unverified, FREE, trial never taken); the device
 * remembers only that he has seen it, per account — like `HelpOfferCard`. A second phone shows it once
 * more, which is harmless and spares a column, an endpoint and an outbox entity before the webinar.</p>
 */
const SEEN = (userId: string) => `majstr.trialOfferSeen.${userId}`;

export function trialOfferSeen(userId: string): boolean {
  try {
    return localStorage.getItem(SEEN(userId)) === '1';
  } catch {
    return false;
  }
}

export function markTrialOfferSeen(userId: string): void {
  try {
    localStorage.setItem(SEEN(userId), '1');
  } catch {
    // Blocked storage: it may show again on the next send, which is harmless.
  }
}

export function wantsTrialOffer(me: UserResponse | undefined): boolean {
  return Boolean(me && me.emailVerified === false && me.plan === 'FREE' && me.trialStartedAt == null
    && !trialOfferSeen(me.id));
}

const AWAITING = (userId: string) => `majstr.awaitingVerification.${userId}`;
const VERIFIED_SEEN = (userId: string) => `majstr.verifiedTrialOfferSeen.${userId}`;

function flag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function setFlag(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Blocked storage: the card may be missed or shown once more, both harmless.
  }
}

/** Remember that this device saw the account UNverified — what makes a later `true` a change, not a
 *  master who verified long ago (and was never promised anything here). */
export function noteVerificationState(me: UserResponse | undefined): void {
  if (me && me.emailVerified === false) setFlag(AWAITING(me.id));
}

export function wantsVerifiedTrialOffer(me: UserResponse | undefined): boolean {
  return Boolean(me && me.emailVerified && me.plan === 'FREE' && me.trialStartedAt == null
    && flag(AWAITING(me.id)) && !flag(VERIFIED_SEEN(me.id)));
}

export function markVerifiedTrialOfferSeen(userId: string): void {
  setFlag(VERIFIED_SEEN(userId));
}

type Listener = () => void;
let pending = false;
const listeners = new Set<Listener>();

/** The one host (`TrialOfferHost`, mounted in `App`) listens; a share sheet calls {@link afterSend}. */
export const trialOfferStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  pending(): boolean {
    return pending;
  },
  /** A link really left the app (shared or copied) — offer the card if he qualifies. Called after
   *  the share sheet has closed, so the two sheets never stack. */
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
