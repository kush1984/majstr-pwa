import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/lib/format.ts';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import type { MessageView } from '@/api/types.ts';
import { useProjectMessages, useMarkMessagesRead, useDeleteMessage } from './useMessages.ts';
import { MessageAttachments } from './MessageAttachments.tsx';

/**
 * The «Повідомлення» block on the object screen: everything left on this object, by a client on the
 * portal or by whoever the master sent their message link to.
 *
 * <p>An unread message is marked read by TAPPING it, never by the screen being opened. Opening an
 * object to check something else used to silently clear the bell for messages the master had not read,
 * which made the counter untrustworthy — the one thing a counter has to be.</p>
 *
 * <p>The highlight is driven by nothing but `isRead`, so the row visibly goes plain, and a toast
 * confirms it: tapping something that only changes a colour reads as nothing having happened.</p>
 */
export function MessagesSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const q = useProjectMessages(projectId);
  const { mutate: markRead } = useMarkMessagesRead(projectId);
  const remove = useDeleteMessage(projectId);
  /** Held until the master confirms — a message is somebody's words, not a draft to bin by accident. */
  const [deleting, setDeleting] = useState<MessageView | null>(null);
  const items = q.data ?? [];

  /** Tapping an unread message marks it read. Already-read ones do nothing, silently. */
  const onRead = (item: MessageView) => {
    if (item.isRead) return;
    markRead([item.id], {
      onSuccess: () => toast.success(t('messages.markedRead')),
      onError: (err) => toast.error(toAppError(err).message),
    });
  };

  return (
    // Set on a tinted panel of its own. On the object screen this block sits directly under the
    // estimates, and both are stacks of white cards on the page background — they read as one long list
    // where the estimates quietly turn into messages. The tint says "different thing" without a divider
    // line or another heading level.
    <section className="mt-6 rounded-card bg-surface-sunken p-3.5">
      <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-primary">
        {items.length > 0
          ? t('messages.titleWithCount', { count: items.length })
          : t('messages.title')}
      </h2>

      {q.isPending ? (
        <p className="py-4 text-center text-sm text-muted">{t('common.loading')}</p>
      ) : q.isError && !q.data ? (
        <p className="py-4 text-center text-sm text-muted">{t('messages.loadError')}</p>
      ) : items.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-surface/60 p-5 text-center">
          <div className="mb-1 text-2xl">💬</div>
          <p className="text-sm text-muted">{t('messages.empty')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const isNew = !item.isRead;
            return (
              <div
                key={item.id}
                className={
                  'rounded-card border p-3.5 transition-colors ' +
                  (isNew ? 'border-brand/40 bg-brand-soft' : 'border-border bg-surface')
                }
              >
                {/* The author line and the text are the tap target — not the whole card. The card also
                    holds a tel: link, a delete button and the attachment rows, and a target wrapping
                    those would both nest interactive elements and give a screen reader one button whose
                    name is the entire message. As a `Read` element it is a plain div once read, so a
                    read message is not a control that does nothing. */}
                <Read enabled={isNew} onRead={() => onRead(item)} label={t('messages.markRead')}>
                  <div className="flex items-center gap-2">
                    {isNew && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-brand" />}
                    <span className="min-w-0 truncate text-sm font-semibold text-primary">
                      {item.authorName || t('messages.client')}
                      {item.estimateName && (
                        <span className="ml-1 font-normal text-muted">
                          {t('messages.aboutEstimate', { name: item.estimateName })}
                        </span>
                      )}
                    </span>
                    <span className="ml-auto whitespace-nowrap text-[11px] text-muted">
                      {formatDateTime(item.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm text-secondary">{item.message}</p>
                </Read>
                <MessageAttachments
                  projectId={projectId}
                  messageId={item.id}
                  files={item.files ?? []}
                />
                <div className="mt-2 flex items-center gap-3">
                  {item.authorPhone && (
                    <a
                      href={`tel:${item.authorPhone.replace(/\s/g, '')}`}
                      className="text-xs font-semibold text-brand"
                    >
                      📞 {item.authorPhone}
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => setDeleting(item)}
                    className="ml-auto text-xs font-semibold text-danger"
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={t('messages.deleteTitle')}
        message={t('messages.deleteMessage', {
          author: deleting?.authorName || t('messages.client'),
        })}
        loading={remove.isPending}
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          if (!target) return;
          remove.mutate(target.id, {
            onError: (err) => toast.error(toAppError(err).message),
          });
        }}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}

/**
 * Wraps the part of a message that marks it read when tapped.
 *
 * <p>A real `<button>` while unread — so it is keyboard-reachable and announced as an action — and a
 * plain wrapper once read, so a message that is already read is not a control that does nothing. The
 * accessible name is given explicitly rather than inherited from the message text, which would have a
 * screen reader read the whole message out as the button's label.</p>
 */
function Read({
  enabled,
  onRead,
  label,
  children,
}: {
  enabled: boolean;
  onRead: () => void;
  label: string;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={onRead}
      aria-label={label}
      className="block w-full cursor-pointer text-left"
    >
      {children}
    </button>
  );
}
