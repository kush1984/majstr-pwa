import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn.ts';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Modal } from '@/components/Modal.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { OfflineNotCached } from '@/components/OfflineNotCached.tsx';
import { useOnline } from '@/lib/useOnline.ts';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { UpgradeBanner } from '@/components/UpgradeBanner.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { MeasurementItemForm } from './MeasurementItemForm.tsx';
import { SketchReviewSheet } from './SketchReviewSheet.tsx';
import { ProjectImportSheet } from './ProjectImportSheet.tsx';
import { ElectricalPlanSheet } from './ElectricalPlanSheet.tsx';
import { useMeasurements, useMeasurementActions } from './useMeasurements.ts';
import type {
  MeasurementItem, MeasurementItemRequest, MeasurementType, ShtrobaPayload,
} from '@/api/types.ts';

const fmtNum = (n: number): string => n.toLocaleString('uk-UA', { maximumFractionDigits: 3 });

/**
 * ⚡ Електрика is PARKED for now — the calculator/plan flow works and is fully tested, but
 * the right product shape (how points, rooms, cable and chase should combine) needs more
 * thought, so the entry points are hidden. All the code (calculator, plan sheet, PlanEditor,
 * types, backend endpoint) stays intact; flip this to `true` to bring the block back. The
 * площі block still filters electrical items out, so existing ones are simply hidden, not lost.
 */
const ELECTRICAL_MEASUREMENTS_ENABLED: boolean = false;

/** Area/room element types (площі) vs electrical ones. Electrical lives in its own block. */
const AREA_TYPES: MeasurementType[] = ['SURFACE', 'PARTITION', 'LINEAR'];
const isElectrical = (t: MeasurementType): boolean =>
  t === 'ELECTRICAL_POINTS' || t === 'SHTROBA' || t === 'CABLE';
const sumBy = (items: MeasurementItem[], pred: (i: MeasurementItem) => boolean): number =>
  items.filter(pred).reduce((s, i) => s + i.result, 0);

/**
 * The room's PRIMARY area — what a master means by «площа кімнати»: the item named
 * «Підлога» when there is one (project import creates it), else the m² sum as before.
 * Without this a floor+walls(+ceiling) package summed into one meaningless number
 * (26,5 м² room showing 88 м²).
 */
const roomPrimaryArea = (room: { areaTotal: number; items: MeasurementItem[] }): number => {
  const floor = room.items.find((i) => i.unit === 'M2' && i.name.trim().toLowerCase() === 'підлога');
  return floor ? floor.result : room.areaTotal;
};

/** «Підлога 26,5 · Стіни 61,2» when the room holds a package; null for a plain room. */
const roomAreaBreakdown = (room: { items: MeasurementItem[] }): string | null => {
  const m2 = room.items.filter((i) => i.unit === 'M2');
  const hasFloor = m2.some((i) => i.name.trim().toLowerCase() === 'підлога');
  if (!hasFloor || m2.length < 2) return null;
  return m2.map((i) => `${i.name} ${fmtNum(i.result)}`).join(' · ');
};

/** Below-ground first, then numeric floors, then мансарда/text, no-floor last. */
const floorSortKey = (floor: string | null): number => {
  if (floor === null) return 10_000;
  const f = floor.toLowerCase();
  if (f.includes('підвал')) return -2;
  if (f.includes('цокол')) return -1;
  const n = Number(f);
  if (Number.isFinite(n) && f.trim() !== '') return n;
  if (f.includes('мансард')) return 999;
  return 500;
};

type EditTarget = {
  roomId?: string;
  item?: MeasurementItem;
  allowedTypes?: MeasurementType[];
  /** New electrical item with no room yet — resolve/create the «Електрика» room on save. */
  ensureElectricalRoom?: boolean;
  /** Pre-fill a NEW chase/cable calculator (from the plan recogniser) without it being an edit. */
  seedPayload?: ShtrobaPayload;
  seedName?: string;
};

/**
 * The «Заміри» tab, split into two clearly-labelled blocks so «план» vs «ескіз» never
 * confuse again: «Кімнати · площі» (area measured by room, from a sketch or by hand) and
 * «⚡ Електрика» (electrician-only: points counted off a plan + the chase calculator).
 * Electrical rows are the seed of the future «Калькулятори» hub. PRO-gated; owner-only.
 */
export function MeasurementsSection({ objectId }: { objectId: string }) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const isPro = (me?.plan ?? 'FREE') !== 'FREE';
  const hasElectrical = ELECTRICAL_MEASUREMENTS_ENABLED && (me?.trades ?? []).includes('ELECTRICAL');

  const online = useOnline();
  const tree = useMeasurements(objectId, isPro);
  const actions = useMeasurementActions(objectId);

  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [roomFloor, setRoomFloor] = useState('');
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [editingRoom, setEditingRoom] = useState<{ id: string; name: string; floor: string | null } | null>(null);
  const [removingRoom, setRemovingRoom] = useState<{ id: string; name: string } | null>(null);
  const [removingItem, setRemovingItem] = useState<{ roomId: string; item: MeasurementItem } | null>(null);
  const [sketchOpen, setSketchOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);

  // Drag a room card onto another floor group. One Pointer Events path covers BOTH touch
  // (phone — the primary case) and mouse (desktop); the rename dialog's floor field stays as
  // the keyboard fallback. `overFloor` drives the drop-zone highlight (null = the no-floor group).
  const [dragging, setDragging] = useState<{ id: string; name: string } | null>(null);
  const [overFloor, setOverFloor] = useState<string | null | undefined>(undefined);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ roomId: string } | null>(null);

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
  // Data first: offline the refetch fails but the cached tree is still perfectly usable.
  // With nothing cached, offline is its own state — a retry there can only fail again.
  if (!tree.data && !online) return <OfflineNotCached compact what={t('offline.dataMeasurements')} />;
  if (!tree.data) {
    return (
      <div className="py-6 text-center">
        <p className="mb-2 text-sm text-muted">{t('measure.loadError')}</p>
        <Button variant="secondary" onClick={() => void tree.refetch()}>{t('common.retry')}</Button>
      </div>
    );
  }

  const data = tree.data;
  const allItems = data.rooms.flatMap((r) => r.items);
  // Totals split by TYPE (not unit): SHTROBA is also м.пог but belongs to electrical, so the
  // «площі» linear figure must exclude it.
  const linearAreaTotal = sumBy(allItems, (i) => i.type === 'LINEAR');
  const shtrobaTotal = sumBy(allItems, (i) => i.type === 'SHTROBA');
  const cableTotal = sumBy(allItems, (i) => i.type === 'CABLE');
  const electrical = data.rooms.flatMap((r) => r.items.filter((i) => isElectrical(i.type)).map((item) => ({ roomId: r.id, item })));
  const electricalRoomId = data.rooms.find((r) => r.items.some((i) => isElectrical(i.type)))?.id;

  // ---- drag a room between floor groups (touch + mouse) ----------------------

  /** The floor of the group under (x,y): a string, `null` for the no-floor group,
   *  or `undefined` when the point is over no group at all (a real "no drop"). */
  const floorAt = (x: number, y: number): string | null | undefined => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-floor-group]');
    if (!el) return undefined;
    const raw = el.getAttribute('data-floor') ?? '';
    return raw === '' ? null : raw;
  };
  const moveGhost = (x: number, y: number) => {
    // Lift the label above the finger so it isn't hidden under the thumb.
    if (ghostRef.current) ghostRef.current.style.transform = `translate(calc(${x}px - 50%), ${y - 40}px)`;
    setOverFloor(floorAt(x, y));
  };
  const onDragStart = (e: React.PointerEvent, room: { id: string; name: string }) => {
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* older browsers */ }
    dragRef.current = { roomId: room.id };
    setDragging(room);
    const { clientX, clientY } = e;
    requestAnimationFrame(() => moveGhost(clientX, clientY));
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    e.preventDefault();
    moveGhost(e.clientX, e.clientY);
  };
  const onDragEnd = (e: React.PointerEvent) => {
    const st = dragRef.current;
    dragRef.current = null;
    setDragging(null);
    setOverFloor(undefined);
    if (!st) return;
    const target = floorAt(e.clientX, e.clientY);
    if (target === undefined) return; // released outside any floor group → no move
    const room = data.rooms.find((r) => r.id === st.roomId);
    if (!room || (room.floor ?? null) === (target ?? null)) return;
    actions.updateRoom.mutate(
      { roomId: st.roomId, req: { name: room.name, floor: target } },
      { onError: (err) => toast.error(toAppError(err).message) },
    );
  };

  const createRoom = () => {
    const name = roomName.trim();
    if (!name) return;
    actions.addRoom.mutate(
      { name, floor: roomFloor.trim() || null },
      {
        onSuccess: () => {
          setRoomName('');
          setRoomFloor('');
          setRoomModalOpen(false);
        },
        onError: (err) => toast.error(toAppError(err).message),
      },
    );
  };

  const ensureElectricalRoom = async (): Promise<string> => {
    if (electricalRoomId) return electricalRoomId;
    const updated = await actions.addRoom.mutateAsync({ name: t('electrical.roomName') });
    return updated.rooms[updated.rooms.length - 1]?.id ?? '';
  };

  const saveItem = async (req: MeasurementItemRequest) => {
    if (!editing) return;
    try {
      if (editing.item) {
        // Editing one item: a SHTROBA and its CABLE sibling diverge from here on (accepted).
        await actions.updateItem.mutateAsync({ roomId: editing.roomId ?? '', itemId: editing.item.id, req });
      } else {
        let roomId = editing.roomId;
        if (!roomId && editing.ensureElectricalRoom) roomId = await ensureElectricalRoom();
        if (!roomId) throw new Error('no room');
        if (req.type === 'SHTROBA') {
          // The calculator produces TWO estimate entities from one input: the chase (work, м.пог)
          // and the cable (material, м). Same payload — the server computes each result by type.
          await actions.addItem.mutateAsync({
            roomId, req: { ...req, name: t('electrical.chaseItemName', { name: req.name }) },
          });
          await actions.addItem.mutateAsync({
            roomId, req: { name: t('electrical.cableItemName', { name: req.name }), type: 'CABLE', payload: req.payload },
          });
        } else {
          await actions.addItem.mutateAsync({ roomId, req });
        }
      }
      setEditing(null);
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  // Plan recogniser → save the point counts, then open the calculator seeded with the drops.
  const applyPlan = async (result: {
    points: { type: string; count: number; heights: number[] }[];
    seed: ShtrobaPayload;
  }) => {
    try {
      const roomId = await ensureElectricalRoom();
      if (result.points.length > 0) {
        await actions.addItem.mutateAsync({
          roomId,
          req: { name: t('electrical.pointsName'), type: 'ELECTRICAL_POINTS', payload: { points: result.points } },
        });
      }
      setEditing({ roomId, allowedTypes: ['SHTROBA'], seedPayload: result.seed, seedName: t('electrical.calcSeedName') });
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  return (
    <div className="space-y-6">
      {/* ---- Block 1: Кімнати · площі --------------------------------------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-brand">{t('measure.areaHeader')}</div>
            <div className="mt-0.5 text-sm text-secondary">
              {/* Σ of FLOOR areas — not floors+walls+ceilings mashed into one number. */}
              <span className="font-bold text-primary">
                {fmtNum(data.rooms.reduce((s, r) => s + roomPrimaryArea(r), 0))} {t('units.M2')}
              </span>
              <span className="text-xs text-muted"> {t('measure.floorAreaLabel')}</span>
              {linearAreaTotal > 0 && (
                <>
                  {' · '}
                  <span className="font-bold text-primary">{fmtNum(linearAreaTotal)} {t('units.LINEAR_METER')}</span>
                </>
              )}
            </div>
          </div>
          <button type="button" onClick={() => setRoomModalOpen(true)}
            className="-mr-2 inline-flex min-h-[44px] items-center px-2 text-[13px] font-semibold text-brand">
            {t('measure.addRoom')}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setSketchOpen(true)}
            className="min-h-[44px] rounded-xl border border-border bg-surface px-3 text-[13px] font-semibold text-brand">
            {t('sketch.button')}
          </button>
          <button type="button" onClick={() => setImportOpen(true)}
            className="min-h-[44px] rounded-xl border border-border bg-surface px-3 text-[13px] font-semibold text-brand">
            {t('projectImport.button')}
          </button>
        </div>

        {(() => {
          // Rooms shown in площі: their non-electrical items only; an electrical-only room
          // (the «Електрика» bucket) is hidden here — it lives in the electrical block.
          const areaRooms = data.rooms
            .map((r) => ({ room: r, areaItems: r.items.filter((i) => !isElectrical(i.type)) }))
            .filter(({ room, areaItems }) => areaItems.length > 0 || !room.items.some((i) => isElectrical(i.type)));

          if (areaRooms.length === 0) {
            return (
              <EmptyState
                icon="📐"
                title={t('measure.emptyTitle')}
                text={t('measure.emptyText')}
                action={
                  <div className="flex flex-col gap-2">
                    <Button onClick={() => setSketchOpen(true)}>{t('sketch.button')}</Button>
                    <Button variant="secondary" onClick={() => setRoomModalOpen(true)}>{t('measure.addRoom')}</Button>
                  </div>
                }
              />
            );
          }

          // Group by the free-text floor label; no labels at all = the flat list as before.
          const floors: (string | null)[] = [];
          for (const { room } of areaRooms) {
            if (!floors.includes(room.floor)) floors.push(room.floor);
          }
          floors.sort((a, b) => floorSortKey(a) - floorSortKey(b));
          const grouped = floors.length > 1 || floors[0] !== null;
          // Dragging a room between floors only makes sense once there is more than one group.
          const canDrag = floors.length > 1;

          return (
            <div className="space-y-3">
              {floors.map((floor) => {
                const group = areaRooms.filter(({ room }) => room.floor === floor);
                const groupArea = group.reduce((s, { room }) => s + roomPrimaryArea(room), 0);
                const groupLinear = group.reduce((s, { areaItems }) => s + sumBy(areaItems, (i) => i.type === 'LINEAR'), 0);
                return (
                  <div key={floor ?? ''} data-floor-group="" data-floor={floor ?? ''}
                    className={cn('space-y-3 rounded-xl transition-colors',
                      dragging && overFloor === floor && 'bg-brand-soft ring-2 ring-brand/40')}>
                    {grouped && (
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-muted">
                          {floor ? t('projectImport.floorLabel', { floor }) : t('projectImport.noFloor')}
                        </span>
                        <span className="text-xs text-muted">
                          {fmtNum(groupArea)} {t('units.M2')}
                          {groupLinear > 0 && ` · ${fmtNum(groupLinear)} ${t('units.LINEAR_METER')}`}
                        </span>
                      </div>
                    )}
                    {group.map(({ room, areaItems }) => {
                const roomLinear = sumBy(areaItems, (i) => i.type === 'LINEAR');
                return (
                  <div key={room.id}
                    className={cn('rounded-card border border-border bg-surface p-3.5 transition-opacity',
                      dragging?.id === room.id && 'opacity-40')}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      {/* Grip = drag this room onto another floor (touch or mouse). */}
                      {canDrag && (
                        <button type="button" aria-label={t('measure.moveRoom')} title={t('measure.moveRoom')}
                          onPointerDown={(e) => onDragStart(e, { id: room.id, name: room.name })}
                          onPointerMove={onDragMove}
                          onPointerUp={onDragEnd}
                          onPointerCancel={onDragEnd}
                          className="-ml-1 flex-shrink-0 touch-none cursor-grab select-none px-1 text-lg leading-none text-muted">
                          ⠿
                        </button>
                      )}
                      {/* Tap the name to rename the room (was: no way to fix a typo but delete). */}
                      <button type="button" onClick={() => setEditingRoom({ id: room.id, name: room.name, floor: room.floor })}
                        className="min-w-0 flex-1 text-left text-sm font-bold text-primary">
                        <span className="break-words">{room.name} <span className="text-xs font-normal text-muted">✏️</span></span>
                      </button>
                      <div className="flex flex-shrink-0 items-center gap-3 text-xs text-muted">
                        <span className="whitespace-nowrap">
                          {fmtNum(roomPrimaryArea(room))} {t('units.M2')}
                          {roomLinear > 0 && ` · ${fmtNum(roomLinear)} ${t('units.LINEAR_METER')}`}
                        </span>
                        <button type="button" aria-label={t('common.delete')} className="text-muted"
                          onClick={() => setRemovingRoom({ id: room.id, name: room.name })}>🗑</button>
                      </div>
                    </div>
                    {/* A package room shows its m² spread, not one mashed number. */}
                    {roomAreaBreakdown(room) && (
                      <p className="-mt-1 mb-2 text-[11px] text-muted">{roomAreaBreakdown(room)} {t('units.M2')}</p>
                    )}

                    <div className="space-y-1.5">
                      {areaItems.map((item) => (
                        <div key={item.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2">
                          <button type="button" onClick={() => setEditing({ roomId: room.id, item })}
                            className="min-w-0 flex-1 text-left">
                            <span className="block truncate text-sm text-primary">{item.name}</span>
                          </button>
                          <span className="whitespace-nowrap text-sm font-semibold text-primary">
                            {fmtNum(item.result)} {t(`units.${item.unit}`)}
                          </span>
                          <button type="button" aria-label={t('common.delete')} className="text-muted"
                            onClick={() => setRemovingItem({ roomId: room.id, item })}>🗑</button>
                        </div>
                      ))}
                    </div>

                    <button type="button" onClick={() => setEditing({ roomId: room.id, allowedTypes: AREA_TYPES })}
                      className="mt-2 text-xs font-semibold text-brand">
                      {t('measure.addElement')}
                    </button>
                  </div>
                );
              })}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </section>

      {/* ---- Block 2: ⚡ Електрика (electricians only) ---------------------- */}
      {hasElectrical && (
        <section className="space-y-3 border-t border-border pt-5">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-brand">{t('electrical.sectionTitle')}</div>
            <div className="mt-0.5 text-sm text-secondary">
              {electrical.length === 0 ? (
                <span className="text-muted">{t('electrical.sectionHint')}</span>
              ) : (
                <>
                  <span className="font-bold text-primary">{fmtNum(data.pieceTotal)} {t('units.PIECE')}</span>
                  {shtrobaTotal > 0 && (
                    <>
                      {' · '}
                      <span className="font-bold text-primary">{fmtNum(shtrobaTotal)} {t('units.LINEAR_METER')}</span>
                    </>
                  )}
                  {cableTotal > 0 && (
                    <>
                      {' · '}
                      <span className="font-bold text-primary">{fmtNum(cableTotal)} {t('units.M')}</span>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setPlanOpen(true)}
              className="min-h-[44px] rounded-xl border border-border bg-surface px-3 text-[13px] font-semibold text-brand">
              {t('electrical.button')}
            </button>
            <button type="button" onClick={() => setEditing({ allowedTypes: ['SHTROBA'], ensureElectricalRoom: true })}
              className="min-h-[44px] rounded-xl border border-border bg-surface px-3 text-[13px] font-semibold text-brand">
              {t('electrical.calcButton')}
            </button>
          </div>

          {electrical.length > 0 && (
            <div className="space-y-1.5">
              {electrical.map(({ roomId, item }) => (
                <div key={item.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2">
                  <button type="button" onClick={() => setEditing({ roomId, item })} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm text-primary">{item.name}</span>
                  </button>
                  <span className="whitespace-nowrap text-sm font-semibold text-primary">
                    {fmtNum(item.result)} {t(`units.${item.unit}`)}
                  </span>
                  <button type="button" aria-label={t('common.delete')} className="text-muted"
                    onClick={() => setRemovingItem({ roomId, item })}>🗑</button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Add-room modal. */}
      <Modal open={roomModalOpen} onClose={() => setRoomModalOpen(false)} title={t('measure.addRoom')}>
        <div className="space-y-3">
          <Input autoFocus placeholder={t('measure.roomNamePlaceholder')} value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createRoom(); }} maxLength={255} />
          <Input placeholder={t('measure.floorPlaceholder')} value={roomFloor}
            onChange={(e) => setRoomFloor(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createRoom(); }} maxLength={20} />
          <Button fullWidth loading={actions.addRoom.isPending} disabled={!roomName.trim()} onClick={createRoom}>
            {t('common.add')}
          </Button>
        </div>
      </Modal>

      {/* Rename / re-floor an existing room. */}
      <Modal open={editingRoom !== null} onClose={() => setEditingRoom(null)} title={t('measure.editRoom')}>
        {editingRoom && (
          <div className="space-y-3">
            <Input autoFocus value={editingRoom.name} maxLength={255}
              placeholder={t('measure.roomNamePlaceholder')}
              onChange={(e) => setEditingRoom({ ...editingRoom, name: e.target.value })} />
            <Input value={editingRoom.floor ?? ''} maxLength={20}
              placeholder={t('measure.floorPlaceholder')}
              onChange={(e) => setEditingRoom({ ...editingRoom, floor: e.target.value })} />
            <Button fullWidth loading={actions.updateRoom.isPending} disabled={!editingRoom.name.trim()}
              onClick={() => {
                actions.updateRoom.mutate(
                  { roomId: editingRoom.id, req: { name: editingRoom.name.trim(), floor: editingRoom.floor?.trim() || null } },
                  { onSuccess: () => setEditingRoom(null), onError: (err) => toast.error(toAppError(err).message) },
                );
              }}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </Modal>

      {/* Element editor modal (area element, chase/cable calculator, or edit any). */}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={
          editing?.item ? t('measure.editElement')
            : editing?.seedPayload || editing?.allowedTypes?.includes('SHTROBA') ? t('electrical.calcTitle')
              : t('measure.addElement')
        }
      >
        {editing && (
          <MeasurementItemForm
            // A seed pre-fills a NEW calculator (from the plan) — synthesised as an initial, but
            // NOT set as editing.item, so saveItem CREATES (a SHTROBA + CABLE pair) instead of updating.
            initial={editing.item ?? (editing.seedPayload
              ? { id: '', name: editing.seedName ?? '', type: 'SHTROBA', unit: 'LINEAR_METER', result: 0, payload: editing.seedPayload, sortOrder: 0 }
              : undefined)}
            allowedTypes={editing.allowedTypes}
            saving={actions.addItem.isPending || actions.updateItem.isPending}
            onSave={(req) => void saveItem(req)}
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

      <SketchReviewSheet open={sketchOpen} onClose={() => setSketchOpen(false)} objectId={objectId} />

      <ProjectImportSheet open={importOpen} onClose={() => setImportOpen(false)} objectId={objectId} />

      <ElectricalPlanSheet
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        objectId={objectId}
        onApply={(result) => { setPlanOpen(false); void applyPlan(result); }}
      />

      {/* Floating label that follows the finger while dragging a room to another floor.
          pointer-events-none so `elementFromPoint` sees the floor group underneath it. */}
      {dragging && (
        <div ref={ghostRef} aria-hidden="true"
          className="pointer-events-none fixed left-0 top-0 z-50 max-w-[60vw] truncate rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white shadow-lg">
          {dragging.name}
        </div>
      )}
    </div>
  );
}
