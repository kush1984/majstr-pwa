import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { useNoteActions, NOTES_KEY } from './useNotes.ts';
import { clearOutbox, listOutbox } from '@/lib/outbox/outbox.ts';
import type { NoteResponse } from '@/api/types.ts';

/**
 * Notes are the most "on site" thing in the app — «ключі в консьєржа», a phone number
 * scribbled at the door — so they get written exactly where there is no signal. Until now
 * all three actions went straight to the network and simply failed there.
 */
beforeEach(async () => { await clearOutbox(); onlineManager.setOnline(false); });
afterEach(() => onlineManager.setOnline(true));

const OBJ = 'p1';

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe('useNoteActions — offline', () => {
  it('adds a note optimistically, newest first, and queues it against the object', async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData<NoteResponse[]>(NOTES_KEY(OBJ), [
      { id: 'old', title: null, phone: null, body: 'Стара', createdAt: '', updatedAt: '' },
    ]);
    const { result } = renderHook(() => useNoteActions(OBJ), { wrapper });

    await act(async () => {
      await result.current.add.mutateAsync({ body: 'Ключі в консьєржа' });
    });

    const list = qc.getQueryData<NoteResponse[]>(NOTES_KEY(OBJ))!;
    expect(list.map((n) => n.body)).toEqual(['Ключі в консьєржа', 'Стара']); // server order
    const ops = await listOutbox();
    expect(ops).toHaveLength(1);
    // deps on the object: a note authored on a freshly-created offline object must not be
    // sent before that object exists on the server.
    expect(ops[0]).toMatchObject({ entity: 'note', type: 'create', deps: [OBJ] });
  });

  it('edits and removes offline too', async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData<NoteResponse[]>(NOTES_KEY(OBJ), [
      { id: 'n1', title: null, phone: null, body: 'Було', createdAt: '', updatedAt: '' },
      { id: 'n2', title: null, phone: null, body: 'Друга', createdAt: '', updatedAt: '' },
    ]);
    const { result } = renderHook(() => useNoteActions(OBJ), { wrapper });

    await act(async () => {
      await result.current.update.mutateAsync({ noteId: 'n1', req: { body: 'Стало' } });
    });
    await act(async () => { await result.current.remove.mutateAsync('n2'); });

    const list = qc.getQueryData<NoteResponse[]>(NOTES_KEY(OBJ))!;
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe('Стало');
    expect((await listOutbox()).map((o) => o.type)).toEqual(['update', 'delete']);
  });
});
