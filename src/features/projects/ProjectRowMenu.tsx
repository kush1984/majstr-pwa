import { useTranslation } from 'react-i18next';
import { ActionMenu, ActionMenuItem } from '@/components/ActionMenu.tsx';
import { useMessageLink } from '@/features/messages/useMessageLink.ts';
import { useObjectStatusAction, isTerminalStage } from './useProjects.ts';
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

  return (
    <>
      <ActionMenu ariaLabel={t('projects.rowActionsAria', { name: project.name })}>
        {(close) => (
          <>
            {/* Hidden once COMPLETED/CANCELLED — nothing to share a chat link about on a closed
                object. */}
            {!isTerminalStage(project.stage) && (
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
            <div className={isTerminalStage(project.stage) ? undefined : 'border-t border-border'}>
              <ObjectStatusMenuItems stage={project.stage} onChoose={(a) => { close(); chooseAction(a); }} />
            </div>
          </>
        )}
      </ActionMenu>

      <ObjectStatusConfirmDialog
        objectAction={objectAction}
        loading={isPending}
        onConfirm={confirm}
        onClose={() => chooseAction(null)}
      />
    </>
  );
}
