import { useSyncExternalStore } from 'react';

/**
 * How many sheets (`Modal`) are open right now — so a toast can get out of their way. On a phone a
 * sheet's buttons are at the bottom, which is exactly where toasts stack; «Прибрано N · Скасувати»
 * sat on the name sheet's «Зберегти» for its five seconds. While any sheet is open the toasts move to
 * the top; with none, they stay where they always were.
 */
let open = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

/** Pair with the returned release — `Modal` calls it for as long as it is open. */
export function holdSheetOpen(): () => void {
  open += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    open -= 1;
    emit();
  };
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAnySheetOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open > 0, () => false);
}
