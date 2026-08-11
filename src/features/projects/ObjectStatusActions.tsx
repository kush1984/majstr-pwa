import { useTranslation } from 'react-i18next';
import { ActionMenuItem } from '@/components/ActionMenu.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import type { ObjectAction } from './useProjects.ts';
import type { ObjectStage } from '@/api/types.ts';

/**
 * The two stage-dependent object-transition menu lines — shared between the object's own hero
 * menu (`ProjectDetailPage`) and the list row menu (`ProjectRowMenu`), so the two never drift.
 */
export function ObjectStatusMenuItems({
  stage,
  onChoose,
}: {
  stage: ObjectStage;
  onChoose: (action: ObjectAction) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {stage === 'COMPLETED' ? (
        <ActionMenuItem
          icon="↩️"
          label={t('projects.objectActionTitle.reopen')}
          onClick={() => onChoose('reopen')}
        />
      ) : (
        <ActionMenuItem
          icon="✓"
          label={t('projects.objectActionTitle.complete')}
          onClick={() => onChoose('complete')}
        />
      )}
      {stage === 'CANCELLED' ? (
        <ActionMenuItem
          icon="↩️"
          label={t('projects.objectActionTitle.restore')}
          onClick={() => onChoose('restore')}
        />
      ) : (
        <ActionMenuItem
          icon="🚫"
          label={t('projects.objectActionTitle.cancel')}
          onClick={() => onChoose('cancel')}
        />
      )}
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
