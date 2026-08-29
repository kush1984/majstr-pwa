import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/EmptyState.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { Badge } from '@/components/Badge.tsx';
import { ActionMenu, ActionMenuItem } from '@/components/ActionMenu.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { InfoPopover } from '@/components/InfoPopover.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { actsApi } from '@/api/acts.ts';
import { openPdfTab } from '@/lib/openPdfTab.ts';
import { formatMoney, formatDate } from '@/lib/format.ts';
import { ACT_STATUS_VARIANT } from '@/lib/labels.ts';
import { routes } from '@/lib/config.ts';
import { useActs, useChangeActStatus, useDeleteAct } from './useActs.ts';
import { actCreateBlock, useNewAct } from './useNewAct.ts';
import { ActShareSheet } from './ActShareSheet.tsx';
import type { WorkActResponse, WorkActStatus } from '@/api/types.ts';

/**
 * The «Акти» tab — real «Акти виконаних робіт» (work-completion certificates). Lists the object's
 * acts (newest first) and offers «+ Новий акт», blocked with an explanation when one act is still
 * open or a FINAL act already closed the object (mirrors the backend guards in {@code WorkActCreator}).
 */
export function ActsSection({ objectId, objectCreatedAt }: { objectId: string; objectCreatedAt?: string }) {
  const { t } = useTranslation();
  const acts = useActs(objectId);
  const newAct = useNewAct(objectId, objectCreatedAt);
  const del = useDeleteAct(objectId);
  const changeStatus = useChangeActStatus(objectId);
  const [confirmDelete, setConfirmDelete] = useState<WorkActResponse | null>(null);

  const moveStatus = (id: string, status: WorkActStatus) => {
    changeStatus.mutate({ id, status }, {
      onError: (err) => toast.error(toAppError(err).message),
    });
  };

  if (acts.isPending) {
    return <div className="py-8 text-center"><Spinner /></div>;
  }

  const list = acts.data ?? [];
  const block = actCreateBlock(list);

  return (
    <div className="space-y-3">
      {/* Create entry — disabled with a reason when the model won't allow another act. */}
      <div>
        <button
          type="button"
          disabled={block !== null}
          onClick={() => newAct.start(list)}
          className="w-full rounded-card border border-dashed border-brand/50 py-2.5 text-sm font-semibold text-brand disabled:cursor-not-allowed disabled:border-border disabled:text-muted"
        >
          {t('acts.newAct')}
        </button>
        {block && (
          <p className="mt-1.5 flex items-center justify-center gap-1 text-center text-[11px] text-muted">
            {t(block === 'open' ? 'acts.blockedOpen' : 'acts.blockedFinal')}
            <InfoPopover text={t(block === 'open' ? 'acts.blockedOpenInfo' : 'acts.blockedFinalInfo')} />
          </p>
        )}
        <p className="mt-1.5 flex items-center justify-center gap-1 text-center text-[11px] text-muted">
          {t('acts.whatIs')}
          <InfoPopover text={t('acts.whatIsInfo')} label={t('acts.whatIs')} />
        </p>
      </div>

      {list.length === 0 ? (
        <EmptyState icon="📑" title={t('acts.emptyTitle')} text={t('acts.emptyText')} />
      ) : (
        <div className="space-y-2">
          {list.map((a) => (
            <ActRow key={a.id} act={a} onDelete={() => setConfirmDelete(a)}
              onMoveStatus={(status) => moveStatus(a.id, status)} />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t('acts.deleteTitle')}
        message={t('acts.deleteConfirm')}
        confirmLabel={t('common.delete')}
        loading={del.isPending}
        onConfirm={() => {
          if (!confirmDelete) return;
          del.mutate(confirmDelete.id, {
            onSuccess: () => setConfirmDelete(null),
            onError: (err) => toast.error(toAppError(err).message),
          });
        }}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function ActRow({ act, onDelete, onMoveStatus }: {
  act: WorkActResponse;
  onDelete: () => void;
  onMoveStatus: (status: WorkActStatus) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [shareOpen, setShareOpen] = useState(false);

  const onPdf = async () => {
    try {
      // Reserved-tab helper — window.open() after the awaited fetch silently fails on iOS Safari.
      await openPdfTab(() => actsApi.fetchPdf(act.id));
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  return (
    <div className="flex items-stretch rounded-card border border-border bg-surface">
      <button
        type="button"
        onClick={() => navigate(routes.act(act.id))}
        className="min-w-0 flex-1 p-3 text-left transition-transform active:scale-[0.99]"
      >
        <div className="flex items-center gap-2">
          {/* With a custom stage name the «Проміжний» word is noise (master feedback); FINAL
              always shows — it is chosen deliberately and closes the object. */}
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-primary">
            {t('acts.title', { number: act.number })}{act.title ? ` — ${act.title}` : ''}
            {(act.kind === 'FINAL' || !act.title) ? ` · ${t('acts.kind.' + act.kind)}` : ''}
          </span>
          <Badge variant={ACT_STATUS_VARIANT[act.status]}>{t('acts.status.' + act.status)}</Badge>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
          <span>{formatDate(act.periodFrom)} – {formatDate(act.periodTo)}</span>
          <span className="font-semibold text-primary">{formatMoney(act.payable)}</span>
        </div>
      </button>
      <ActionMenu ariaLabel={t('acts.actions')}>
        {(close) => (
          <>
            <ActionMenuItem icon="📂" label={t('common.open')} onClick={() => { close(); void navigate(routes.act(act.id)); }} />
            {act.status !== 'REJECTED' && (
              <ActionMenuItem icon="📤" label={t('acts.share')} onClick={() => { close(); setShareOpen(true); }} />
            )}
            <ActionMenuItem icon="📄" label={t('acts.pdf')} onClick={() => { close(); void onPdf(); }} />
            {/* The client did NOT sign — the owner records the outcome (review fix: REJECTED was
                unreachable, and a declined SENT act wedged the object forever). */}
            {act.status === 'SENT' && (
              <>
                <ActionMenuItem icon="↩️" label={t('acts.recall')}
                  onClick={() => { close(); onMoveStatus('DRAFT'); }} />
                <ActionMenuItem icon="✖️" label={t('acts.markRejected')}
                  onClick={() => { close(); onMoveStatus('REJECTED'); }} />
              </>
            )}
            {act.status === 'REJECTED' && (
              <ActionMenuItem icon="↩️" label={t('acts.recall')}
                onClick={() => { close(); onMoveStatus('DRAFT'); }} />
            )}
            {(act.status === 'DRAFT' || act.status === 'REJECTED') && (
              <ActionMenuItem icon="🗑" label={t('common.delete')} danger onClick={() => { close(); onDelete(); }} />
            )}
          </>
        )}
      </ActionMenu>
      <ActShareSheet actId={act.id} open={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  );
}
