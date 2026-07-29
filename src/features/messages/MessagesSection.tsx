import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/lib/format.ts';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import type { MessageView } from '@/api/types.ts';
import { useProjectMessages, useMarkMessagesRead, useDeleteMessage } from './useMessages.ts';

/**
 * The «Повідомлення» block on the object screen: everything left on this object, by a client on the
 * portal or by whoever the master sent their message link to. Newest highlighted.
 *
 * Opening the screen marks the unread ones read, so the row badge and the header bell clear — but they
 * stay highlighted for this viewing, so the master can still see which ones were new.
 */
export function MessagesSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const q = useProjectMessages(projectId);
  const { mutate: markRead } = useMarkMessagesRead(projectId);
  const remove = useDeleteMessage(projectId);
  /** Held until the master confirms — a message is somebody's words, not a draft to bin by accident. */
  const [deleting, setDeleting] = useState<MessageView | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current || !q.data) return;
    processed.current = true;
    const unread = q.data.filter((x) => !x.isRead).map((x) => x.id);
    if (unread.length > 0) {
      setNewIds(new Set(unread));
      markRead(unread);
    }
  }, [q.data, markRead]);

  const items = q.data ?? [];

  return (
    <section className="mt-6">
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
        <div className="rounded-card border border-dashed border-border bg-surface-sunken p-5 text-center">
          <div className="mb-1 text-2xl">💬</div>
          <p className="text-sm text-muted">{t('messages.empty')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const isNew = newIds.has(item.id) || !item.isRead;
            return (
              <div
                key={item.id}
                className={
                  'rounded-card border p-3.5 ' +
                  (isNew ? 'border-brand/40 bg-brand-soft' : 'border-border bg-surface')
                }
              >
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
