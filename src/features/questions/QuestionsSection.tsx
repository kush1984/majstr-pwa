import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/lib/format.ts';
import { useProjectQuestions, useMarkQuestionsRead } from './useQuestions.ts';

/**
 * "Питання від клієнта" block on the project screen (Fix F #12). Lists the
 * questions clients left on the portal, newest highlighted. Opening the screen
 * marks the unread ones read (so the card/bell counters clear), but they stay
 * highlighted for this viewing so the contractor can tell which were new.
 */
export function QuestionsSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const q = useProjectQuestions(projectId);
  const { mutate: markRead } = useMarkQuestionsRead(projectId);
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
          ? t('questions.titleWithCount', { count: items.length })
          : t('questions.title')}
      </h2>

      {q.isPending ? (
        <p className="py-4 text-center text-sm text-muted">{t('common.loading')}</p>
      ) : q.isError ? (
        <p className="py-4 text-center text-sm text-muted">{t('questions.loadError')}</p>
      ) : items.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-surface-sunken p-5 text-center">
          <div className="mb-1 text-2xl">💬</div>
          <p className="text-sm text-muted">{t('questions.empty')}</p>
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
                    {item.authorName || t('questions.client')}
                    {item.estimateName && (
                      <span className="ml-1 font-normal text-muted">
                        {t('questions.aboutEstimate', { name: item.estimateName })}
                      </span>
                    )}
                  </span>
                  <span className="ml-auto whitespace-nowrap text-[11px] text-muted">
                    {formatDateTime(item.createdAt)}
                  </span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-secondary">{item.message}</p>
                {item.authorPhone && (
                  <a
                    href={`tel:${item.authorPhone}`}
                    className="mt-2 inline-block text-xs font-semibold text-brand"
                  >
                    📞 {item.authorPhone}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
