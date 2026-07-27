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
 * The «Нотатки» tab: object-scoped free-text notes with an optional title + phone (phone →
 * one-tap tel: call). A retention utility — no PRO gate, available on every plan. PRIVATE:
 * never reaches the client portal / PDF / share. Mobile-first (the master is on site).
 */
export function NotesSection({ objectId }: { objectId: string }) {
  const { t } = useTranslation();
  const online = useOnline();
  const notes = useNotes(objectId);
  const actions = useNoteActions(objectId);

  const [editing, setEditing] = useState<NoteResponse | 'new' | null>(null);
  const [removing, setRemoving] = useState<NoteResponse | null>(null);

  if (notes.isPending) {
    return <div className="py-8 text-center text-brand"><Spinner /></div>;
  }
  // Data first: offline the refetch fails but the cached notes are still perfectly usable.
  // With nothing cached, offline is its own state — a retry there can only fail again.
  if (!notes.data && !online) return <OfflineNotCached compact what={t('offline.dataNotes')} />;
  if (!notes.data) {
    return (
      <div className="py-6 text-center">
        <p className="mb-2 text-sm text-muted">{t('notes.loadError')}</p>
        <Button variant="secondary" onClick={() => void notes.refetch()}>{t('common.retry')}</Button>
      </div>
    );
  }

  const list = notes.data;

  return (
    <div className="space-y-4">
      {list.length === 0 ? (
        <EmptyState
          icon="📝"
          title={t('notes.emptyTitle')}
          text={t('notes.emptyText')}
          action={<Button onClick={() => setEditing('new')}>{t('notes.add')}</Button>}
        />
      ) : (
        <>
          <div className="flex justify-end">
            <button type="button" onClick={() => setEditing('new')} className="text-[13px] font-semibold text-brand">
              {t('notes.add')}
            </button>
          </div>
          <div className="space-y-3">
            {list.map((note) => (
              <div key={note.id} className="rounded-card border border-border bg-surface p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {note.title && (
                      <h3 className="mb-1 truncate text-sm font-bold text-primary">{note.title}</h3>
                    )}
                    {/* pre-wrap keeps the master's line breaks ("ключі в консьєржа\nстояк до 9:00"). */}
                    <p className="whitespace-pre-wrap break-words text-sm text-secondary">{note.body}</p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2 text-muted">
                    <button type="button" aria-label={t('common.edit')} onClick={() => setEditing(note)}>✏️</button>
                    <button type="button" aria-label={t('common.delete')} onClick={() => setRemoving(note)}>🗑</button>
                  </div>
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
        </>
      )}

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
    </div>
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
