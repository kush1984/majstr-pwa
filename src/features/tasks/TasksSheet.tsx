import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { Modal } from '@/components/Modal.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { InlineTextCell } from '@/components/InlineTextCell.tsx';
import { OfflineNotCached } from '@/components/OfflineNotCached.tsx';
import { useOnline } from '@/lib/useOnline.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { useTaskActions, useTasks } from './useTasks.ts';
import type { TaskResponse } from '@/api/types.ts';

/**
 * «Що треба зробити» on an object (majster-bot). A bottom sheet from the object's ⋮, like notes.
 * The row is the editor: tap the circle to tick it, tap the text to retype it. What the Telegram
 * bot files lands here too. Read-only on a closed object — viewing is never taken away.
 */
export function TasksSheet({
  open,
  onClose,
  objectId,
  readOnly = false,
}: {
  open: boolean;
  onClose: () => void;
  objectId: string;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const tasks = useTasks(objectId);
  const actions = useTaskActions(objectId);
  const [draft, setDraft] = useState('');
  const [showDone, setShowDone] = useState(false);

  const onError = (err: unknown) => toast.error(toAppError(err).message);
  // «Видалено · Скасувати», as everywhere a row goes: the undo adds the same text back.
  const remove = (task: TaskResponse) => actions.remove.mutate(task.id, {
    onError,
    onSuccess: () => toast.success(t('tasks.removed'), {
      action: { label: t('inline.undo'), onClick: () => actions.add.mutate(task.body, { onError }) },
    }),
  });
  const add = () => {
    const body = draft.trim();
    if (!body) return;
    actions.add.mutate(body, { onError });
    setDraft('');
  };

  const list = tasks.data ?? [];
  const openTasks = list.filter((task) => !task.done);
  const doneTasks = list.filter((task) => task.done);

  return (
    <Modal open={open} onClose={onClose} title={t('tasks.title')}>
      {!readOnly && (
        <form
          className="mb-4 flex gap-2"
          onSubmit={(e) => { e.preventDefault(); add(); }}
        >
          <input
            value={draft}
            maxLength={500}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('tasks.placeholder')}
            aria-label={t('tasks.placeholder')}
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2.5 text-base text-primary focus:border-brand focus:outline-none"
          />
          <Button type="submit" disabled={!draft.trim()}>{t('tasks.add')}</Button>
        </form>
      )}

      {tasks.isPending ? (
        <div className="py-8 text-center text-brand"><Spinner /></div>
      ) : !tasks.data && !online ? (
        <OfflineNotCached compact what={t('offline.dataTasks')} />
      ) : !tasks.data ? (
        <div className="py-6 text-center">
          <p className="mb-2 text-sm text-muted">{t('tasks.loadError')}</p>
          <Button variant="secondary" onClick={() => void tasks.refetch()}>{t('common.retry')}</Button>
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon="☑️" title={t('tasks.emptyTitle')} text={t('tasks.emptyText')} />
      ) : (
        <div className="space-y-4">
          <ul className="divide-y divide-border rounded-card border border-border bg-surface">
            {openTasks.map((task) => (
              <TaskRow key={task.id} task={task} readOnly={readOnly}
                onToggle={() => actions.update.mutate({ taskId: task.id, req: { done: true } }, { onError })}
                onRename={(body) => actions.update.mutate({ taskId: task.id, req: { body } }, { onError })}
                onRemove={() => remove(task)} />
            ))}
            {openTasks.length === 0 && (
              <li className="px-3.5 py-3 text-sm text-muted">{t('tasks.allDone')}</li>
            )}
          </ul>
          {doneTasks.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowDone((v) => !v)}
                className="mb-2 text-[13px] font-semibold text-muted">
                {showDone ? '▾' : '▸'} {t('tasks.doneSection', { count: doneTasks.length })}
              </button>
              {showDone && (
                <ul className="divide-y divide-border rounded-card border border-border bg-surface">
                  {doneTasks.map((task) => (
                    <TaskRow key={task.id} task={task} readOnly={readOnly}
                      onToggle={() => actions.update.mutate({ taskId: task.id, req: { done: false } }, { onError })}
                      onRename={(body) => actions.update.mutate({ taskId: task.id, req: { body } }, { onError })}
                      onRemove={() => remove(task)} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function TaskRow({
  task, readOnly, onToggle, onRename, onRemove,
}: {
  task: TaskResponse;
  readOnly: boolean;
  onToggle: () => void;
  onRename: (body: string) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="ph-mask flex items-start gap-3 px-3.5 py-3">
      <button
        type="button"
        role="checkbox"
        aria-checked={task.done}
        aria-label={task.done ? t('tasks.markOpen') : t('tasks.markDone')}
        disabled={readOnly}
        onClick={onToggle}
        className="-my-2.5 -ml-2.5 flex h-11 w-11 flex-shrink-0 items-center justify-center"
      >
        {/* The circle is 24 px; the button around it is the 44 px a thumb needs. */}
        <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-sm ${
          task.done ? 'border-brand bg-brand text-white' : 'border-muted bg-surface'}`}>
          {task.done ? '✓' : ''}
        </span>
      </button>
      <div className={`min-w-0 flex-1 text-sm ${task.done ? 'text-muted line-through' : 'text-primary'}`}>
        <InlineTextCell value={task.body} ariaLabel={t('tasks.rename')} maxLength={500}
          readOnly={readOnly} onCommit={onRename} />
      </div>
      {!readOnly && (
        <button type="button" aria-label={t('common.delete')} onClick={onRemove}
          className="-my-2.5 -mr-2.5 flex h-11 w-11 flex-shrink-0 items-center justify-center text-muted">🗑</button>
      )}
    </li>
  );
}
