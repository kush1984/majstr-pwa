import { api } from './client.ts';
import type {
  InboxCreateRequest, InboxEntryView, InboxItemUpdateRequest, InboxOutcome, TelegramNotificationsRequest, TelegramStatus,
} from './types.ts';

/** «Вхідні» — what the bot or a quick add could not file by itself (majster-bot). */
export const inboxApi = {
  list(): Promise<InboxEntryView[]> {
    return api.get<InboxEntryView[]>('/api/inbox').then((r) => r.data);
  },
  count(): Promise<number> {
    return api.get<{ open: number }>('/api/inbox/count').then((r) => r.data.open);
  },
  /** Parses on the server (a model call), so it rides the long timeout. */
  create(req: InboxCreateRequest, id: string): Promise<InboxOutcome> {
    return api.post<InboxOutcome>('/api/inbox', req, { headers: { 'X-Entity-Uuid': id } }).then((r) => r.data);
  },
  retry(entryId: string): Promise<InboxOutcome> {
    return api.post<InboxOutcome>(`/api/inbox/${entryId}/retry`).then((r) => r.data);
  },
  undo(entryId: string): Promise<InboxOutcome> {
    return api.post<InboxOutcome>(`/api/inbox/${entryId}/undo`).then((r) => r.data);
  },
  /** A «Додаткові роботи» estimate for the lines that found every estimate signed — the master's tap. */
  createDraft(entryId: string): Promise<InboxOutcome> {
    return api.post<InboxOutcome>(`/api/inbox/${entryId}/estimate`).then((r) => r.data);
  },
  discard(entryId: string): Promise<void> {
    return api.delete(`/api/inbox/${entryId}`).then(() => undefined);
  },
  updateItem(itemId: string, req: InboxItemUpdateRequest): Promise<InboxEntryView> {
    return api.patch<InboxEntryView>(`/api/inbox/items/${itemId}`, req).then((r) => r.data);
  },
  applyItem(itemId: string): Promise<InboxOutcome> {
    return api.post<InboxOutcome>(`/api/inbox/items/${itemId}/apply`).then((r) => r.data);
  },
  discardItem(itemId: string): Promise<InboxEntryView> {
    return api.delete<InboxEntryView>(`/api/inbox/items/${itemId}`).then((r) => r.data);
  },
};

export const telegramApi = {
  status(): Promise<TelegramStatus> {
    return api.get<TelegramStatus>('/api/telegram').then((r) => r.data);
  },
  /** null when the bot is not configured on this server. */
  link(): Promise<string | null> {
    return api.post<{ url?: string }>('/api/telegram/link').then((r) => r.data.url ?? null);
  },
  unlink(): Promise<void> {
    return api.delete('/api/telegram').then(() => undefined);
  },
  /** «Сповіщення в Telegram» on / off (V226) — answers the new status. */
  setNotifications(req: TelegramNotificationsRequest): Promise<TelegramStatus> {
    return api.put<TelegramStatus>('/api/telegram/notifications', req).then((r) => r.data);
  },
};
