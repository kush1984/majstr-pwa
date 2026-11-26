import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inboxApi, telegramApi } from '@/api/inbox.ts';
import { newUuid } from '@/lib/uuid.ts';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import type { InboxEntryView, InboxItemUpdateRequest } from '@/api/types.ts';

export const INBOX_KEY = ['inbox'] as const;
const LIST_KEY = [...INBOX_KEY, 'list'] as const;
const COUNT_KEY = [...INBOX_KEY, 'count'] as const;
export const TELEGRAM_KEY = ['telegram'] as const;

export function useInbox() {
  return useQuery({ queryKey: LIST_KEY, queryFn: () => inboxApi.list() });
}

/** The home strip's number. Refetched on focus: the bot writes while the app is closed. */
export function useInboxCount() {
  return useQuery({ queryKey: COUNT_KEY, queryFn: () => inboxApi.count(), refetchOnWindowFocus: true });
}

/**
 * What changes the inbox also changes the records it files into (tasks, notes, the shopping list,
 * an estimate, money) — so every success refreshes everything on screen rather than guessing which.
 */
export function useInboxActions() {
  const qc = useQueryClient();
  const refreshAll = () => { void qc.invalidateQueries(); };
  const cancel = () => qc.cancelQueries({ queryKey: LIST_KEY });

  return {
    /**
     * Quick add. Queues with no signal — the note is the point, the parse can wait — and replays
     * under the same id, so the server files it once.
     */
    create: useMutation({
      networkMode: 'always',
      mutationFn: (text: string) => {
        const id = newUuid();
        return offlineMutate<void>({
          entity: 'inboxEntry', entityId: id, type: 'create', payload: { req: { text } },
          online: async () => { await inboxApi.create({ text }, id); },
          cancel,
          onOnlineSuccess: refreshAll,
          optimistic: () => qc.setQueryData<InboxEntryView[]>(LIST_KEY, (old) => [{
            id, source: 'PWA', status: 'PARSING', rawText: text, createdAt: new Date().toISOString(), items: [],
          }, ...(old ?? [])]),
        });
      },
    }),
    retry: useMutation({ mutationFn: (entryId: string) => inboxApi.retry(entryId), onSuccess: refreshAll }),
    undo: useMutation({ mutationFn: (entryId: string) => inboxApi.undo(entryId), onSuccess: refreshAll }),
    createDraft: useMutation({ mutationFn: (entryId: string) => inboxApi.createDraft(entryId), onSuccess: refreshAll }),
    discard: useMutation({ mutationFn: (entryId: string) => inboxApi.discard(entryId), onSuccess: refreshAll }),
    updateItem: useMutation({
      mutationFn: (vars: { itemId: string; req: InboxItemUpdateRequest }) => inboxApi.updateItem(vars.itemId, vars.req),
      onSuccess: (entry) => {
        qc.setQueryData<InboxEntryView[]>(LIST_KEY, (old) => (old ?? []).map((e) => (e.id === entry.id ? entry : e)));
      },
    }),
    applyItem: useMutation({ mutationFn: (itemId: string) => inboxApi.applyItem(itemId), onSuccess: refreshAll }),
    discardItem: useMutation({ mutationFn: (itemId: string) => inboxApi.discardItem(itemId), onSuccess: refreshAll }),
  };
}

/** `enabled: false` — not asked at all (the app-wide offer host asks only after a send). */
export function useTelegram(enabled = true) {
  return useQuery({ queryKey: TELEGRAM_KEY, queryFn: () => telegramApi.status(), refetchOnWindowFocus: true, enabled });
}

export function useTelegramActions() {
  const qc = useQueryClient();
  return {
    link: useMutation({ mutationFn: () => telegramApi.link() }),
    unlink: useMutation({
      mutationFn: () => telegramApi.unlink(),
      onSuccess: () => { void qc.invalidateQueries({ queryKey: TELEGRAM_KEY }); },
    }),
    /** «Сповіщення в Telegram» (V226): the answer is the new status, written straight into the cache. */
    notifications: useMutation({
      mutationFn: (enabled: boolean) => telegramApi.setNotifications({ enabled }),
      onSuccess: (status) => { qc.setQueryData(TELEGRAM_KEY, status); },
    }),
  };
}
