import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionMenu, ActionMenuItem } from '@/components/ActionMenu.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { useMessageLink } from '@/features/messages/useMessageLink.ts';
import { useObjectStatusAction, isTerminalStage, useDeleteProject } from './useProjects.ts';
import { ObjectStatusMenuItems, ObjectStatusConfirmDialog } from './ObjectStatusActions.tsx';
import type { ProjectResponse } from '@/api/types.ts';

/**
 * The ⋮ on a row of the object list: the chat link, plus завершити/скасувати/повернути/відновити
 * — so closing out an object doesn't require opening it first. Started as chat-link-only
 * (`ChatLinkRowButton`); the status actions moved here from the object's own hero menu on request,
 * reusing the exact same {@link ObjectStatusMenuItems}/{@link useObjectStatusAction} pieces so the
 * two menus can never drift on wording or transitions.
 *
 * <p>The chat-link privacy hint stays (see {@link useMessageLink}'s own doc) — it is the one thing
 * about that link a master needs to be sure of before sending it. Portal-link revoke is still
 * deliberately absent from a list row: a destructive action next to quick status changes is a
 * mis-tap waiting to happen, and the object's own screen has room for it.</p>
 *
 * <p>The chat-link item disappears once the object is COMPLETED/CANCELLED — {@link isTerminalStage}
 * — leaving only the reopen/restore way back in, same rule as the detail page's FAB.</p>
 */
export function ProjectRowMenu({ project }: { project: ProjectResponse }) {
  const { t } = useTranslation();
  const { copy } = useMessageLink(project.id);
  const { objectAction, chooseAction, confirm, isPending } = useObjectStatusAction(project.id);
  const deleteProject = useDeleteProject();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Permanent delete is offered only on a closed-out object (COMPLETED/CANCELLED) — a live object is
  // deleted by cancelling first, so a mis-tap can't wipe active work.
  const terminal = isTerminalStage(project.stage);

  return (
    <>
      <ActionMenu ariaLabel={t('projects.rowActionsAria', { name: project.name })}>
        {(close) => (
          <>
            {/* Hidden once COMPLETED/CANCELLED — nothing to share a chat link about on a closed
                object. */}
            {!terminal && (
              <>
                <ActionMenuItem
                  icon="🔗"
                  label={t('messageLink.copy')}
                  onClick={() => { close(); void copy(); }}
                />
                <p className="border-t border-border px-4 py-2 text-[11px] leading-snug text-muted">
                  {t('messageLink.hint')}
                </p>
              </>
            )}
            <div className={terminal ? undefined : 'border-t border-border'}>
              <ObjectStatusMenuItems stage={project.stage} onChoose={(a) => { close(); chooseAction(a); }} />
            </div>
            {terminal && (
              <div className="border-t border-border">
                <ActionMenuItem
                  icon="🗑"
                  danger
                  label={t('projects.deleteObject')}
                  onClick={() => { close(); setConfirmDelete(true); }}
                />
              </div>
            )}
          </>
        )}
      </ActionMenu>

      <ObjectStatusConfirmDialog
        objectAction={objectAction}
        loading={isPending}
        onConfirm={confirm}
        onClose={() => chooseAction(null)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={t('projects.deleteObjectTitle')}
        message={t('projects.deleteObjectConfirm')}
        confirmLabel={t('projects.deleteObject')}
        loading={deleteProject.isPending}
        onConfirm={() => deleteProject.mutate(project.id, {
          onSuccess: () => { setConfirmDelete(false); toast.success(t('projects.deleteObjectDone')); },
          onError: (err) => toast.error(toAppError(err).message),
        })}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}
