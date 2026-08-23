import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from '@/components/Spinner.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { Modal } from '@/components/Modal.tsx';
import { Input } from '@/components/Input.tsx';
import { Button } from '@/components/Button.tsx';
import { UpgradeBanner } from '@/components/UpgradeBanner.tsx';
import { usePlanLimits, isAtLimit } from '@/features/plan/usePlanLimits.ts';
import { toast } from '@/hooks/useToast.ts';
import { useOnlineGuard } from '@/hooks/useOnlineGuard.ts';
import { toAppError } from '@/api/errors.ts';
import { downscaleImage } from '@/lib/image.ts';
import { cn } from '@/lib/cn.ts';
import {
  usePhotos, useUploadPhoto, useSetPhotoVisibility, useDeletePhoto,
  usePhotoFolders, useCreatePhotoFolder, useDeletePhotoFolder, useSetPhotoFolder,
} from './usePhotos.ts';
import { AuthPhoto, PhotoLightbox } from './PhotoView.tsx';
import type { ProjectPhotoResponse } from '@/api/types.ts';

const MAX_BYTES = 10 * 1024 * 1024; // pre-check on the original; downscale shrinks it further

/** Touch = a device that plausibly has a camera; a desktop file dialog ignores `capture` anyway. */
const canCapture = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;

/** The reserved «Чеки» value; `null` is «Інше». Anything else is a master-invented folder name. */
const RECEIPTS = 'RECEIPTS';

/** A folder key as the API spells it: `null` = «Інше», 'RECEIPTS' = «Чеки», else a custom name. */
type FolderKey = string | null;

/**
 * «Фото» tab — a real folder tree, not one long scroll (master feedback: «папочки такі як у
 * віндовз, щоб файл, який туди перемістили, більше не було видно»). The tab shows EITHER the list
 * of folders OR the inside of one; a photo lives in exactly one folder and is never also loose at
 * some root, because there is no root to be loose in.
 *
 * Two folders always exist and are virtual (never rows in `project_photo_folder`): «Чеки»
 * (`folder = 'RECEIPTS'`) and «Інше» (`folder = null`, where a progress photo lands). Custom
 * folders are persisted, so an empty one the master created ahead of its photos survives a reload.
 *
 * Uploading happens INSIDE a folder and lands there (the `folder` upload param) — a photo added in
 * «Чеки» is a RECEIPT, anywhere else a MANUAL progress photo, so the two per-object budgets keep
 * their meaning. Every receipt of the object shows up in «Чеки», estimate-linked ones included:
 * a folder that quietly hides part of its contents is exactly what the master was complaining
 * about. Either source can be shown to the client (SHARED → appears on the portal). Files come
 * from an authenticated stream, so each tile fetches its blob with the bearer token (`AuthPhoto`).
 */
export function PhotosSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { online } = useOnlineGuard(); // photo uploads have no offline queue yet
  const photos = usePhotos(projectId);
  const upload = useUploadPhoto(projectId);
  const limits = usePlanLimits();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<ProjectPhotoResponse | null>(null);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [moving, setMoving] = useState<ProjectPhotoResponse | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  // `null` = the folder list; an object = standing inside that folder.
  const [open, setOpen] = useState<{ key: FolderKey } | null>(null);
  const del = useDeletePhoto(projectId);
  const folders = usePhotoFolders(projectId);
  const createFolder = useCreatePhotoFolder(projectId);
  const deleteFolder = useDeletePhotoFolder(projectId);
  const setFolder = useSetPhotoFolder(projectId);

  const all = photos.data ?? [];
  // Which folder a photo sits in decides nothing about the CAP: that stays per source across the
  // whole object, because that is what the server counts.
  const manualCount = all.filter((p) => p.source === 'MANUAL').length;
  const receiptCount = all.filter((p) => p.source === 'RECEIPT').length;
  const atPhotoLimit = isAtLimit(manualCount, limits.data?.maxPhotosPerObject);
  const atReceiptLimit = isAtLimit(receiptCount, limits.data?.maxReceiptPhotosPerObject);

  const inFolder = (key: FolderKey) => all.filter((p) => (p.folder ?? null) === key);
  // Every folder wears the same plain folder icon — «Чеки» is a folder, not a special widget.
  const folderList: { key: FolderKey; label: string; folderId?: string }[] = [
    { key: RECEIPTS, label: t('photos.receiptsFolderTitle') },
    { key: null, label: t('photos.folderOther') },
    ...(folders.data ?? []).map((f) => ({ key: f.name, label: f.name, folderId: f.id })),
  ];

  const current = open ? folderList.find((f) => f.key === open.key) ?? null : null;
  const currentPhotos = open ? inFolder(open.key) : [];
  const uploadsAreReceipts = open?.key === RECEIPTS;
  const atLimit = uploadsAreReceipts ? atReceiptLimit : atPhotoLimit;

  const validateAndDownscale = async (file: File) => {
    if (!online) {
      toast.error(t('offline.needConnection'));
      return null;
    }
    if (!/^image\/(png|jpeg|jpg|webp)$/.test(file.type)) {
      toast.error(t('photos.badType'));
      return null;
    }
    // Size-check AFTER downscaling — a raw camera shot can exceed 10 MB and still
    // compress to a few hundred KB; rejecting it up front would break the
    // take-a-photo-on-site flow on modern phones.
    const compact = await downscaleImage(file);
    if (compact.size > MAX_BYTES) {
      toast.error(t('photos.tooLarge'));
      return null;
    }
    return compact;
  };

  /** Upload into the folder the master is standing in — there is no root to fall back to. */
  const onPick = async (file: File | undefined) => {
    if (!file || !open) return;
    const compact = await validateAndDownscale(file);
    if (!compact) return;
    upload.mutate(
      { file: compact, source: uploadsAreReceipts ? 'RECEIPT' : 'MANUAL', folder: open.key },
      {
        onSuccess: () => toast.success(t('photos.uploaded')),
        onError: (err) => toast.error(toAppError(err).message),
      },
    );
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await del.mutateAsync(deleting.id);
      setDeleting(null);
      toast.success(t('photos.deleted'));
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  if (photos.isPending) {
    return (
      <section className="py-8 text-center">
        <Spinner />
      </section>
    );
  }

  return (
    <section>
      {open === null ? (
        <>
          <ul className="space-y-2">
            {folderList.map((f) => (
              <li key={f.key ?? '·'}>
                <button
                  type="button"
                  onClick={() => setOpen({ key: f.key })}
                  className="flex min-h-[56px] w-full items-center gap-3 rounded-card border border-border bg-surface px-3 py-2.5 text-left"
                >
                  <span className="text-xl leading-none">📁</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-primary">{f.label}</span>
                    <span className="block text-[12px] text-muted">
                      {t('photos.folderCount', { n: inFolder(f.key).length })}
                    </span>
                  </span>
                  <span className="text-faint" aria-hidden="true">›</span>
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => setNewFolderOpen(true)}
            className="mt-4 text-[13px] font-semibold text-brand"
          >
            + {t('photos.newFolder')}
          </button>
        </>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen(null)}
              aria-label={t('common.back')}
              className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg text-muted"
            >
              ‹
            </button>
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-primary">
              📁 {current?.label}
            </h3>
            {/* Deletable only while empty — the server enforces the same, because photos
                reference folders by NAME and a delete must never silently re-file them. */}
            {current?.folderId && currentPhotos.length === 0 && (
              <button
                type="button"
                className="text-[13px] font-semibold text-danger"
                onClick={() => deleteFolder.mutate(current.folderId as string, {
                  onSuccess: () => setOpen(null),
                  onError: (err) => toast.error(toAppError(err).message),
                })}
              >
                {t('common.delete')}
              </button>
            )}
          </div>

          {/* Two explicit paths: `capture` guarantees the camera opens on the object; a plain
              picker with a concrete MIME list often shows no camera option on Android. On a
              desktop (no touch) the camera button is meaningless — gallery goes full-width. */}
          <div className={cn('mb-3 grid gap-2', canCapture ? 'grid-cols-2' : 'grid-cols-1')}>
            {canCapture && (
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                disabled={upload.isPending || atLimit}
                title={atLimit ? t('photos.limitReached') : undefined}
                className="min-h-[44px] rounded-xl border border-border bg-surface px-3 text-[13px] font-semibold text-brand disabled:opacity-60"
              >
                📷 {t('photos.takePhoto')}
              </button>
            )}
            <button
              type="button"
              onClick={() => galleryRef.current?.click()}
              disabled={upload.isPending || atLimit}
              title={atLimit ? t('photos.limitReached') : undefined}
              className="min-h-[44px] rounded-xl border border-border bg-surface px-3 text-[13px] font-semibold text-brand disabled:opacity-60"
            >
              {upload.isPending
                ? t('photos.uploading')
                : <>🖼 {canCapture ? t('photos.fromGallery') : t('photos.addFile')}</>}
            </button>
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                void onPick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <input
              ref={galleryRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                void onPick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>

          {atLimit && (
            <div className="mb-3">
              <UpgradeBanner
                text={t('photos.limitHint', {
                  max: uploadsAreReceipts
                    ? limits.data?.maxReceiptPhotosPerObject
                    : limits.data?.maxPhotosPerObject,
                })}
                trigger="PHOTO_LIMIT"
              />
            </div>
          )}

          {currentPhotos.length === 0 ? (
            <EmptyState icon="📷" title={t('photos.emptyTitle')} text={t('photos.folderEmpty')} />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {currentPhotos.map((photo, i) => (
                <PhotoTile
                  key={photo.id}
                  projectId={projectId}
                  photo={photo}
                  onView={() => setViewIndex(i)}
                  onDelete={() => setDeleting(photo)}
                  onMove={() => setMoving(photo)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <NewFolderModal
        open={newFolderOpen}
        busy={createFolder.isPending}
        onCreate={(name) => createFolder.mutate(name, {
          onSuccess: () => setNewFolderOpen(false),
          onError: (err) => toast.error(toAppError(err).message),
        })}
        onClose={() => setNewFolderOpen(false)}
      />

      <MovePhotoSheet
        photo={moving}
        folders={(folders.data ?? []).map((f) => f.name)}
        busy={setFolder.isPending}
        onMove={(folder) => {
          if (!moving) return;
          setFolder.mutate({ photoId: moving.id, folder }, {
            onSuccess: () => setMoving(null),
            onError: (err) => toast.error(toAppError(err).message),
          });
        }}
        onClose={() => setMoving(null)}
      />

      {viewIndex !== null && currentPhotos[viewIndex] && (
        <PhotoLightbox
          list={currentPhotos}
          index={viewIndex}
          onIndex={setViewIndex}
          onClose={() => setViewIndex(null)}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={t('photos.deleteTitle')}
        message={t('photos.deleteMessage')}
        confirmLabel={t('common.delete')}
        loading={del.isPending}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}

function PhotoTile({
  projectId,
  photo,
  onView,
  onDelete,
  onMove,
}: {
  projectId: string;
  photo: ProjectPhotoResponse;
  onView: () => void;
  onDelete: () => void;
  onMove: () => void;
}) {
  const { t } = useTranslation();
  const setVisibility = useSetPhotoVisibility(projectId);
  const shared = photo.visibility === 'SHARED';
  const isReceipt = photo.source === 'RECEIPT';

  const toggleShare = () => {
    setVisibility.mutate(
      { photoId: photo.id, visibility: shared ? 'PRIVATE' : 'SHARED' },
      { onError: (err) => toast.error(toAppError(err).message) },
    );
  };

  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <AuthPhoto fileUrl={photo.fileUrl} alt={photo.caption ?? t('photos.title')} onView={onView} />
      <div className="p-2">
        {isReceipt && (
          <p className="truncate text-[11px] text-muted">
            🧾 {photo.estimateName ? t('photos.receiptOf', { name: photo.estimateName }) : t('photos.receipt')}
          </p>
        )}
        {!isReceipt && photo.caption && <p className="truncate text-[11px] text-primary">{photo.caption}</p>}
        <button
          type="button"
          onClick={toggleShare}
          disabled={setVisibility.isPending}
          className={cn(
            'mt-1 w-full rounded-lg px-2 py-1 text-[11px] font-semibold disabled:opacity-60',
            shared ? 'bg-brand-soft text-brand' : 'bg-surface-sunken text-muted',
          )}
        >
          {shared ? t('photos.shownToClient') : t('photos.showToClient')}
        </button>
        <button
          type="button"
          onClick={onMove}
          className="mt-1 w-full text-[11px] text-faint hover:text-brand"
        >
          📁 {t('photos.moveToFolder')}
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={t('common.delete')}
          className="mt-1 w-full text-[11px] text-faint hover:text-danger"
        >
          🗑 {t('common.delete')}
        </button>
      </div>
    </div>
  );
}

/** Create an EMPTY folder ahead of its photos (master decision). */
function NewFolderModal({ open, busy, onCreate, onClose }: {
  open: boolean;
  busy: boolean;
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setName('');
  }
  return (
    <Modal open={open} onClose={onClose} title={t('photos.newFolder')}>
      <div className="space-y-3">
        <Input value={name} placeholder={t('photos.folderNameHint')}
          onChange={(e) => setName(e.target.value)} />
        <Button fullWidth loading={busy} disabled={name.trim() === ''}
          onClick={() => onCreate(name.trim())}>
          {t('photos.createFolder')}
        </Button>
      </div>
    </Modal>
  );
}

/** Move one photo: the two virtual defaults, every custom folder, and a new name in one sheet —
 *  moving into a new name creates the folder (the server persists it). */
function MovePhotoSheet({ photo, folders, busy, onMove, onClose }: {
  photo: ProjectPhotoResponse | null;
  folders: string[];
  busy: boolean;
  onMove: (folder: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState('');
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if ((photo?.id ?? null) !== openedFor) {
    setOpenedFor(photo?.id ?? null);
    setNewName('');
  }
  const current = photo?.folder ?? null;
  const options: { value: string | null; label: string }[] = [
    { value: null, label: t('photos.folderOther') },
    { value: RECEIPTS, label: t('photos.receiptsFolderTitle') },
    ...folders.map((f): { value: string | null; label: string } => ({ value: f, label: f })),
  ];
  return (
    <Modal open={photo !== null} onClose={onClose} title={t('photos.moveToFolder')}>
      <div className="space-y-2">
        {options.map((o) => (
          <button key={o.value ?? '·'} type="button" disabled={busy || o.value === current}
            onClick={() => onMove(o.value)}
            className="block w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-left text-sm font-medium text-primary disabled:opacity-50">
            {o.label}{o.value === current ? ` · ${t('photos.currentFolder')}` : ''}
          </button>
        ))}
        <div className="flex gap-2 pt-1">
          <Input value={newName} placeholder={t('photos.folderNameHint')}
            onChange={(e) => setNewName(e.target.value)} />
          <Button variant="secondary" disabled={busy || newName.trim() === ''}
            onClick={() => onMove(newName.trim())}>
            {t('photos.moveToNew')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
