import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Modal } from '@/components/Modal.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { OfflineNotCached } from '@/components/OfflineNotCached.tsx';
import { useOnline } from '@/lib/useOnline.ts';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { useNotes, useNoteActions } from './useNotes.ts';
import type { NoteResponse } from '@/api/types.ts';

/**
 * «Нотатки» — object-scoped free-text notes with an optional title + phone (phone → one-tap tel:
 * call). A retention utility — no PRO gate, available on every plan. PRIVATE: never reaches the
 * client portal / PDF / share. Mobile-first (the master is on site).
 *
 * <p>Lives in the object's FAB now (acts iteration), not a tab — a bottom sheet over the object
 * screen, same shell as {@code ChatLinkSheet}. The list + add/edit/delete logic is unchanged from
 * the old {@code NotesSection}; only the container moved.</p>
 *
 * <p>{@code readOnly} (a terminal object stage) hides creating/editing/deleting but keeps viewing —
 * the golden rule is «limit creating new, never take away access to what already exists».</p>
 */
export function NotesSheet({
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
  const notes = useNotes(objectId);
  const actions = useNoteActions(objectId);

  const [editing, setEditing] = useState<NoteResponse | 'new' | null>(null);
  const [removing, setRemoving] = useState<NoteResponse | null>(null);

  return (
    <>
      <Modal open={open} onClose={onClose} title={t('notes.title')}>
        {notes.isPending ? (
          <div className="py-8 text-center text-brand"><Spinner /></div>
        ) : !notes.data && !online ? (
          // Data first: offline the refetch fails but cached notes are still usable; with nothing
          // cached, offline is its own state — a retry there can only fail again.
          <OfflineNotCached compact what={t('offline.dataNotes')} />
        ) : !notes.data ? (
          <div className="py-6 text-center">
            <p className="mb-2 text-sm text-muted">{t('notes.loadError')}</p>
            <Button variant="secondary" onClick={() => void notes.refetch()}>{t('common.retry')}</Button>
          </div>
        ) : notes.data.length === 0 ? (
          <EmptyState
            icon="📝"
            title={t('notes.emptyTitle')}
            text={t('notes.emptyText')}
            action={readOnly ? undefined : <Button onClick={() => setEditing('new')}>{t('notes.add')}</Button>}
          />
        ) : (
          <div className="space-y-4">
            {!readOnly && (
              <div className="flex justify-end">
                <button type="button" onClick={() => setEditing('new')} className="text-[13px] font-semibold text-brand">
                  {t('notes.add')}
                </button>
              </div>
            )}
            <div className="space-y-3">
              {notes.data.map((note) => (
                <div key={note.id} className="rounded-card border border-border bg-surface p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {note.title && (
                        <h3 className="mb-1 truncate text-sm font-bold text-primary">{note.title}</h3>
                      )}
                      {/* pre-wrap keeps the master's line breaks ("ключі в консьєржа\nстояк до 9:00"). */}
                      <p className="whitespace-pre-wrap break-words text-sm text-secondary">{note.body}</p>
                    </div>
                    {!readOnly && (
                      <div className="flex flex-shrink-0 items-center gap-2 text-muted">
                        <button type="button" aria-label={t('common.edit')} onClick={() => setEditing(note)}>✏️</button>
                        <button type="button" aria-label={t('common.delete')} onClick={() => setRemoving(note)}>🗑</button>
                      </div>
                    )}
                  </div>
                  {note.phone && (
                    <a
                      href={`tel:${note.phone.replace(/\s/g, '')}`}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 text-sm font-semibold text-brand"
                    >
                      📞 {note.phone}
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <NoteSheet
        open={editing !== null}
        initial={editing === 'new' ? null : editing}
        saving={actions.add.isPending || actions.update.isPending}
        onClose={() => setEditing(null)}
        onSave={(req) => {
          const opts = {
            onSuccess: () => setEditing(null),
            onError: (err: unknown) => toast.error(toAppError(err).message),
          };
          if (editing && editing !== 'new') {
            actions.update.mutate({ noteId: editing.id, req }, opts);
          } else {
            actions.add.mutate(req, opts);
          }
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        title={t('notes.deleteTitle')}
        message={t('notes.deleteConfirm')}
        confirmLabel={t('common.delete')}
        loading={actions.remove.isPending}
        onConfirm={() => {
          if (!removing) return;
          actions.remove.mutate(removing.id, {
            onSuccess: () => setRemoving(null),
            onError: (err) => toast.error(toAppError(err).message),
          });
        }}
        onClose={() => setRemoving(null)}
      />
    </>
  );
}

/** Add / edit sheet — the ONLY required field is the body; title & phone are optional. */
function NoteSheet({
  open,
  initial,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: NoteResponse | null;
  saving: boolean;
  onClose: () => void;
  onSave: (req: { title: string | null; phone: string | null; body: string }) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [body, setBody] = useState('');
  const [ready, setReady] = useState(false);

  // Seed the fields once each time the sheet opens (keyed off open + note id).
  const seedKey = `${open}:${initial?.id ?? 'new'}`;
  const [lastSeed, setLastSeed] = useState('');
  if (open && seedKey !== lastSeed) {
    setLastSeed(seedKey);
    setTitle(initial?.title ?? '');
    setPhone(initial?.phone ?? '');
    setBody(initial?.body ?? '');
    setReady(true);
  }
  if (!open && ready) setReady(false);

  const canSave = body.trim().length > 0;

  return (
    <Modal open={open} onClose={onClose} title={initial ? t('notes.editTitle') : t('notes.addTitle')}>
      <div className="space-y-3">
        <Input
          placeholder={t('notes.titlePlaceholder')}
          value={title}
          maxLength={255}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Input
          type="tel"
          inputMode="tel"
          placeholder={t('notes.phonePlaceholder')}
          value={phone}
          maxLength={40}
          onChange={(e) => setPhone(e.target.value)}
        />
        <textarea
          rows={5}
          maxLength={2000}
          autoFocus
          placeholder={t('notes.bodyPlaceholder')}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
        <Button
          fullWidth
          loading={saving}
          disabled={!canSave}
          onClick={() =>
            onSave({ title: title.trim() || null, phone: phone.trim() || null, body: body.trim() })
          }
        >
          {t('common.save')}
        </Button>
      </div>
    </Modal>
  );
}
