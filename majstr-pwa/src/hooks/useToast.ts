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

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

type Listener = () => void;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

function push(kind: ToastKind, message: string, ttlMs = 4000): number {
  const id = nextId++;
  toasts = [...toasts, { id, kind, message }];
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
  success: (m: string, ttl?: number) => push('success', m, ttl),
  error: (m: string, ttl?: number) => push('error', m, ttl ?? 6000),
  info: (m: string, ttl?: number) => push('info', m, ttl),
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
