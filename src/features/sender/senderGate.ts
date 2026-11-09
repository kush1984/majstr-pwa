import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/api/auth.ts';
import { toAppError } from '@/api/errors.ts';
import { ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import type { UserResponse } from '@/api/types.ts';

/**
 * «Як вас підписати в документі?» — the name a document carries, asked the first time one is about
 * to leave for a client (V190). Registration no longer asks for it, and the backend refuses a share
 * link, a portal, a letter or a PDF without it (403 `SENDER_NAME_REQUIRED`, `SendReadiness`).
 *
 * <p>The name is ALWAYS asked here, verified email or not (share-without-verification, 2026-11-09):
 * what the master sends himself needs only the name. A verified email is asked only where WE send a
 * letter — `useEmailGate` on the «надіслати листом» buttons, and `EMAIL_NOT_VERIFIED` from the
 * server.</p>
 *
 * <p>One sheet for the whole app ({@link SenderSheetHost}, mounted in `App`), opened from wherever a
 * document leaves: call {@link useSenderGate} before the action, and {@link isSenderNameRequired} on
 * a refusal the action got anyway (an older cache, another device).</p>
 */
export function hasSenderName(me: UserResponse | undefined): boolean {
  return Boolean(me?.fullName?.trim());
}

/** No phone: the client on the portal has no way to call him — the one gap worth a reminder. The
 *  company is not reminded about (review): most masters work under their own name, and being asked
 *  every session about a company they do not have would only annoy. */
export function missesSenderPhone(me: UserResponse | undefined): boolean {
  return !me?.phone?.trim();
}

export function isSenderNameRequired(err: unknown): boolean {
  return toAppError(err).code === 'SENDER_NAME_REQUIRED';
}

/**
 * `name` — required, the document cannot leave without it. `extras` — a light reminder that the phone
 * is empty: «Пропустити» is one tap, it is asked once per app session (owner, 2026-11-07: remind,
 * gently, every time he works), never right after the name sheet, and never before a PDF — only before
 * a link goes to a client (review: a first PDF cost three taps).
 */
export type SenderSheetMode = 'name' | 'extras';

type Listener = () => void;
/** Everyone waiting on the open sheet; null while it is closed. */
let waiting: ((ok: boolean) => void)[] | null = null;
let openMode: SenderSheetMode = 'name';
let remindedThisSession = false;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

export const senderSheetStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  isOpen(): boolean {
    return waiting !== null;
  },
  mode(): SenderSheetMode {
    return openMode;
  },
  /** Opens the sheet, or joins the one already open — two taps never stack two sheets. Resolves
   *  true once saved, false when closed or skipped. */
  request(mode: SenderSheetMode = 'name'): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const opening = waiting === null;
      if (opening) openMode = mode;
      waiting = [...(waiting ?? []), resolve];
      if (opening) emit();
    });
  },
  settle(ok: boolean): void {
    const current = waiting ?? [];
    waiting = null;
    emit();
    for (const resolve of current) resolve(ok);
  },
};

/** For tests: a fresh app session, the reminder not yet shown. */
export function resetSenderReminder(): void {
  remindedThisSession = false;
}

export interface SenderGateOptions {
  /** Offer the phone reminder. Off for a PDF. Default on. */
  remind?: boolean;
}

function wouldAskName(me: UserResponse | undefined): boolean {
  return !hasSenderName(me);
}

function wouldRemind(me: UserResponse | undefined, opts: SenderGateOptions): boolean {
  return opts.remind !== false && !remindedThisSession && hasSenderName(me) && missesSenderPhone(me);
}

/** Whether `ensureSender` would open a sheet right now — for a caller that must decide inside the
 *  tap (a PDF tab reserved by `openPdfTab`) without awaiting first. */
export function senderGateWouldAsk(me: UserResponse | undefined, opts: SenderGateOptions = {}): boolean {
  return wouldAskName(me) || wouldRemind(me, opts);
}

/**
 * What happened at the gate: `ready` — nothing to ask, carry on in the same tap; `saved` — he was
 * asked and saved; `skipped` — he passed over the reminder, the document goes as it is;
 * `cancelled` — he closed the required name sheet, nothing goes.
 *
 * <p>A sheet matters for a PDF: its tab is reserved in the tap itself (iOS refuses `window.open`
 * after an await), so a sheet in between spends the tap. Pass `onAsk` to cancel such a reservation
 * just before a sheet opens, and ask for a fresh tap on anything but `ready` and `cancelled`.</p>
 */
export type SenderGateResult = 'ready' | 'saved' | 'skipped' | 'cancelled';

/**
 * `await ensureSender()` before a document leaves. A cached name is trusted (a name only ever goes
 * from missing to present through this app); a missing one is checked against the server first — it
 * may have been typed on another device — and only then is he asked. With a name in place, an empty
 * company or phone gets the light reminder, once per session.
 */
export function useSenderGate() {
  const qc = useQueryClient();
  return useCallback(async (onAsk?: () => void, opts: SenderGateOptions = {}): Promise<SenderGateResult> => {
    let me = qc.getQueryData<UserResponse>(ME_QUERY_KEY);
    if (!hasSenderName(me)) {
      try {
        me = await qc.fetchQuery<UserResponse>({ queryKey: ME_QUERY_KEY, queryFn: authApi.me, staleTime: 0 });
      } catch {
        // Offline: the sheet says so when he tries to save.
      }
    }
    if (wouldAskName(me)) {
      onAsk?.();
      // The name sheet holds the phone field too: a reminder about it in the same session is a repeat.
      remindedThisSession = true;
      return (await senderSheetStore.request('name')) ? 'saved' : 'cancelled';
    }
    if (wouldRemind(me, opts)) {
      remindedThisSession = true;
      onAsk?.();
      return (await senderSheetStore.request('extras')) ? 'saved' : 'skipped';
    }
    return 'ready';
  }, [qc]);
}
