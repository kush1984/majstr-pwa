import { useTranslation } from 'react-i18next';
import { ActionMenuItem } from '@/components/ActionMenu.tsx';
import { FabAction } from '@/components/Fab.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import type { ObjectAction } from './useProjects.ts';
import type { ObjectStage } from '@/api/types.ts';

/**
 * The stage-dependent object-transition menu lines — shared between the list row menu
 * (`ProjectRowMenu`) and the object detail page's FAB (`ObjectStatusFabActions` below), so the
 * two never drift in wording. COMPLETED/CANCELLED are dead ends: the ONLY way out is
 * reopen/restore — no cancelling something already completed, no completing something cancelled.
 */
export function ObjectStatusMenuItems({
  stage,
  onChoose,
}: {
  stage: ObjectStage;
  onChoose: (action: ObjectAction) => void;
}) {
  const { t } = useTranslation();
  if (stage === 'COMPLETED') {
    return (
      <ActionMenuItem
        icon="↩️"
        label={t('projects.objectActionTitle.reopen')}
        onClick={() => onChoose('reopen')}
      />
    );
  }
  if (stage === 'CANCELLED') {
    return (
      <ActionMenuItem
        icon="↩️"
        label={t('projects.objectActionTitle.restore')}
        onClick={() => onChoose('restore')}
      />
    );
  }
  return (
    <>
      <ActionMenuItem
        icon="✓"
        label={t('projects.objectActionTitle.complete')}
        onClick={() => onChoose('complete')}
      />
      <ActionMenuItem
        icon="🚫"
        label={t('projects.objectActionTitle.cancel')}
        onClick={() => onChoose('cancel')}
      />
    </>
  );
}

/**
 * Same stage-dependent transitions, rendered as {@link FabAction} pills instead of dropdown
 * rows — the object detail page's own hero used to carry a second, separate ⋮ menu for just these
 * lines, which read as two competing action surfaces on one screen. They now live in the same
 * FAB as «Поділитися»/«Посилання на чат».
 */
export function ObjectStatusFabActions({
  stage,
  onChoose,
}: {
  stage: ObjectStage;
  onChoose: (action: ObjectAction) => void;
}) {
  const { t } = useTranslation();
  if (stage === 'COMPLETED') {
    return (
      <FabAction
        icon="↩️"
        label={t('projects.objectActionTitle.reopen')}
        onClick={() => onChoose('reopen')}
      />
    );
  }
  if (stage === 'CANCELLED') {
    return (
      <FabAction
        icon="↩️"
        label={t('projects.objectActionTitle.restore')}
        onClick={() => onChoose('restore')}
      />
    );
  }
  return (
    <>
      <FabAction
        icon="✓"
        label={t('projects.objectActionTitle.complete')}
        onClick={() => onChoose('complete')}
      />
      <FabAction
        icon="🚫"
        label={t('projects.objectActionTitle.cancel')}
        onClick={() => onChoose('cancel')}
      />
    </>
  );
}

export function ObjectStatusConfirmDialog({
  objectAction,
  onConfirm,
  onClose,
  loading,
}: {
  objectAction: ObjectAction | null;
  onConfirm: () => void;
  onClose: () => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={objectAction !== null}
      title={t('projects.objectActionTitle.' + (objectAction ?? 'complete'))}
      message={t('projects.objectActionConfirm.' + (objectAction ?? 'complete'))}
      confirmLabel={t('projects.objectActionTitle.' + (objectAction ?? 'complete'))}
      loading={loading}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
