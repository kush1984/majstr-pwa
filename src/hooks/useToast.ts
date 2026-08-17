import { useSyncExternalStore } from 'react';

/**
 * Tiny global toast store. Lives outside React so any module — even
 * the axios interceptor — can call `toast.error(...)` without a hook.
 *
 * Trade-off: a global store can't be unit-tested in isolation, but for
 * one screen-level UX primitive that's fine. If we ever need scoped
 * toast queues we'll switch to a context provider.
 */

export type ToastKind = 'success' | 'error' | 'info';

/** An optional single action rendered as a button inside the toast (e.g. «Відкрити» after a
 *  duplicate lands in another tab). Tapping it dismisses the toast, then runs `onClick`. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

/** Second argument to the toast helpers: a plain number keeps the old `toast.x(msg, 5000)`
 *  positional-ttl form working; the object form adds an optional action. */
type ToastOpts = number | { ttlMs?: number; action?: ToastAction };

type Listener = () => void;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

function push(kind: ToastKind, message: string, opts: ToastOpts | undefined, defaultTtl: number): number {
  const ttlMs = typeof opts === 'number' ? opts : opts?.ttlMs ?? defaultTtl;
  const action = typeof opts === 'number' ? undefined : opts?.action;
  const id = nextId++;
  toasts = [...toasts, { id, kind, message, action }];
  emit();
  if (ttlMs > 0) {
    setTimeout(() => dismiss(id), ttlMs);
  }
  return id;
}

function dismiss(id: number): void {
  const before = toasts.length;
  toasts = toasts.filter((t) => t.id !== id);
  if (toasts.length !== before) emit();
}

export const toast = {
  // An action toast leans on a longer default so the master has time to reach the button.
  success: (m: string, opts?: ToastOpts) => push('success', m, opts, 4000),
  error: (m: string, opts?: ToastOpts) => push('error', m, opts, 6000),
  info: (m: string, opts?: ToastOpts) => push('info', m, opts, 4000),
  dismiss,
};

function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getSnapshot(): Toast[] {
  return toasts;
}

export function useToast() {
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { toasts: value, dismiss };
}
