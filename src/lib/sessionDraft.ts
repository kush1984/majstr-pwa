import { useEffect, useState } from 'react';

/**
 * A half-filled form survives a reload, an accidental «Назад» or the phone killing the tab while
 * the master looked something up (review P1-2). `sessionStorage`, not `localStorage`: a draft
 * belongs to this tab and this visit, and is gone with them. Never put a password here.
 *
 * <p>Storage can throw (Safari private mode, a full quota) or be unavailable; the form then simply
 * works as before, without the draft.</p>
 */
const PREFIX = 'majstr.draft.';

export function readSessionDraft<T>(key: string): T | undefined {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw == null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

export function writeSessionDraft(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // No draft — the form still works.
  }
}

/** Drops every draft whose key starts with `keyPrefix` — call it once the form has been submitted. */
export function clearSessionDrafts(keyPrefix: string): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(PREFIX + keyPrefix)) sessionStorage.removeItem(k);
    }
  } catch {
    // Nothing stored, nothing to clear.
  }
}

/** `useState` restored from, and written back to, the tab's session. */
export function useSessionDraft<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readSessionDraft<T>(key) ?? initial);
  useEffect(() => { writeSessionDraft(key, value); }, [key, value]);
  return [value, setValue];
}
