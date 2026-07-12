import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Modal } from '@/components/Modal.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { UpgradeBanner } from '@/components/UpgradeBanner.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { MeasurementItemForm } from './MeasurementItemForm.tsx';
import { useMeasurements, useMeasurementActions } from './useMeasurements.ts';
import type { MeasurementItem, MeasurementItemRequest } from '@/api/types.ts';

const fmtNum = (n: number): string => n.toLocaleString('uk-UA', { maximumFractionDigits: 3 });

/**
 * The «Заміри» tab: measure the object once by room, then (Stage 2) pull the metrics into
 * estimate line quantities. PRO-gated — FREE sees a locked teaser (trigger MEASUREMENTS).
 * Owner-only; never leaves for the client portal/PDF.
 */
export function MeasurementsSection({ objectId }: { objectId: string }) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const isPro = (me?.plan ?? 'FREE') !== 'FREE';

  const tree = useMeasurements(objectId, isPro);
  const actions = useMeasurementActions(objectId);

  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [editing, setEditing] = useState<{ roomId: string; item?: MeasurementItem } | null>(null);
  const [removingRoom, setRemovingRoom] = useState<{ id: string; name: string } | null>(null);
  const [removingItem, setRemovingItem] = useState<{ roomId: string; item: MeasurementItem } | null>(null);

  if (!isPro) {
    return (
      <div className="rounded-card border border-border bg-surface p-4">
        <div className="mb-2 text-3xl">📐</div>
        <h3 className="mb-1 text-base font-bold text-primary">{t('measure.proTitle')}</h3>
        <p className="mb-4 text-sm text-secondary">{t('measure.proPitch')}</p>
        <UpgradeBanner text={t('measure.proHint')} trigger="MEASUREMENTS" />
      </div>
    );
  }

  if (tree.isPending) {
    return <div className="py-8 text-center text-brand"><Spinner /></div>;
  }
  if (tree.isError || !tree.data) {
    return (
      <div className="py-6 text-center">
        <p className="mb-2 text-sm text-muted">{t('measure.loadError')}</p>
        <Button variant="secondary" onClick={() => void tree.refetch()}>{t('common.retry')}</Button>
      </div>
    );
  }

  const data = tree.data;

  const createRoom = () => {
    const name = roomName.trim();
    if (!name) return;
    actions.addRoom.mutate(
      { name },
      {
        onSuccess: () => {
          setRoomName('');
          setRoomModalOpen(false);
        },
        onError: (err) => toast.error(toAppError(err).message),
      },
    );
  };

  const saveItem = (req: MeasurementItemRequest) => {
    if (!editing) return;
    const opts = {
      onSuccess: () => setEditing(null),
      onError: (err: unknown) => toast.error(toAppError(err).message),
    };
    if (editing.item) {
      actions.updateItem.mutate({ roomId: editing.roomId, itemId: editing.item.id, req }, opts);
    } else {
      actions.addItem.mutate({ roomId: editing.roomId, req }, opts);
    }
  };

  return (
    <div className="space-y-4">
      {/* Object totals + add room. */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-secondary">
          <span className="font-bold text-primary">{fmtNum(data.areaTotal)} {t('units.M2')}</span>
          {' · '}
          <span className="font-bold text-primary">{fmtNum(data.linearTotal)} {t('units.LINEAR_METER')}</span>
        </div>
        <button type="button" onClick={() => setRoomModalOpen(true)} className="text-[13px] font-semibold text-brand">
          {t('measure.addRoom')}
        </button>
      </div>

      {data.rooms.length === 0 ? (
        <EmptyState
          icon="📐"
          title={t('measure.emptyTitle')}
          text={t('measure.emptyText')}
          action={<Button onClick={() => setRoomModalOpen(true)}>{t('measure.addRoom')}</Button>}
        />
      ) : (
        <div className="space-y-3">
          {data.rooms.map((room) => (
            <div key={room.id} className="rounded-card border border-border bg-surface p-3.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-bold text-primary">{room.name}</span>
                <div className="flex items-center gap-3 text-xs text-muted">
                  <span>{fmtNum(room.areaTotal)} {t('units.M2')} · {fmtNum(room.linearTotal)} {t('units.LINEAR_METER')}</span>
                  <button type="button" aria-label={t('common.delete')} className="text-muted"
                    onClick={() => setRemovingRoom({ id: room.id, name: room.name })}>🗑</button>
                </div>
              </div>

              <div className="space-y-1.5">
                {room.items.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2">
                    <button type="button" onClick={() => setEditing({ roomId: room.id, item })}
                      className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm text-primary">{item.name}</span>
                    </button>
                    <span className="whitespace-nowrap text-sm font-semibold text-primary">
                      {fmtNum(item.result)} {t(item.unit === 'LINEAR_METER' ? 'units.LINEAR_METER' : 'units.M2')}
                    </span>
                    <button type="button" aria-label={t('common.delete')} className="text-muted"
                      onClick={() => setRemovingItem({ roomId: room.id, item })}>🗑</button>
                  </div>
                ))}
              </div>

              <button type="button" onClick={() => setEditing({ roomId: room.id })}
                className="mt-2 text-xs font-semibold text-brand">
                {t('measure.addElement')}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add-room modal. */}
      <Modal open={roomModalOpen} onClose={() => setRoomModalOpen(false)} title={t('measure.addRoom')}>
        <div className="space-y-3">
          <Input autoFocus placeholder={t('measure.roomNamePlaceholder')} value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createRoom(); }} maxLength={255} />
          <Button fullWidth loading={actions.addRoom.isPending} disabled={!roomName.trim()} onClick={createRoom}>
            {t('common.add')}
          </Button>
        </div>
      </Modal>

      {/* Element editor modal. */}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.item ? t('measure.editElement') : t('measure.addElement')}
      >
        {editing && (
          <MeasurementItemForm
            initial={editing.item}
            saving={actions.addItem.isPending || actions.updateItem.isPending}
            onSave={saveItem}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={removingRoom !== null}
        title={t('measure.deleteRoom')}
        message={t('measure.deleteRoomConfirm', { name: removingRoom?.name ?? '' })}
        confirmLabel={t('common.delete')}
        loading={actions.deleteRoom.isPending}
        onConfirm={() => {
          if (!removingRoom) return;
          actions.deleteRoom.mutate(removingRoom.id, {
            onSuccess: () => setRemovingRoom(null),
            onError: (err) => toast.error(toAppError(err).message),
          });
        }}
        onClose={() => setRemovingRoom(null)}
      />

      <ConfirmDialog
        open={removingItem !== null}
        title={t('measure.deleteElement')}
        message={t('measure.deleteElementConfirm', { name: removingItem?.item.name ?? '' })}
        confirmLabel={t('common.delete')}
        loading={actions.deleteItem.isPending}
        onConfirm={() => {
          if (!removingItem) return;
          actions.deleteItem.mutate(
            { roomId: removingItem.roomId, itemId: removingItem.item.id },
            {
              onSuccess: () => setRemovingItem(null),
              onError: (err) => toast.error(toAppError(err).message),
            },
          );
        }}
        onClose={() => setRemovingItem(null)}
      />
    </div>
  );
}
