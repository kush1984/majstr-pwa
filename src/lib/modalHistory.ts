/**
 * System «Назад» closes the SHEET, not the screen under it (review P1-1).
 *
 * <p>Android's back button (and an iOS edge swipe) walks browser history, and an open `Modal` had
 * no entry there — so «Назад» left the whole screen, sheet and half-typed form with it. Each open
 * modal now pushes one entry; a `popstate` that leaves the TOP modal's entry closes that modal only.
 * Nested modals stack: the top one answers first.</p>
 *
 * <p>The pushed state COPIES `history.state`, because react-router keeps its own keys there
 * (`usr`, `key`, `idx`): the router then sees the same location on either side of our entry and
 * treats the back as a no-op, and its leave guard (a pathname compare) is never tripped.</p>
 *
 * <p>Closing a modal from the UI removes its entry again (`history.go(-n)`, batched so a parent and
 * a child closing in one commit cost one jump) — only entries ABOVE every still-open modal (a sheet
 * that opened another one as it closed keeps its own), and only while the browser sits on one of
 * ours. A save that navigates away from inside a sheet has pushed past it, and going back
 * then would undo the navigation; the stale entry it leaves is just a step back to the same page.</p>
 */
interface Entry {
  id: string;
  onBack: () => void;
}

const KEY = 'majstrModal';
/** Open modals, in the order they opened — the last one answers Back. */
const live: Entry[] = [];
/**
 * Our entries in history, bottom → top, as far as we know: the last one is where the browser sits
 * when it sits on one of ours. No counters of «pops to ignore» — a popstate is read off where it
 * LANDED, so a traversal that a quick open-after-close raced past cannot leave a counter wrong.
 */
let entries: string[] = [];
let listening = false;
let flushQueued = false;
let nextId = 0;

function currentModalId(): string | undefined {
  const state: unknown = window.history.state;
  if (state && typeof state === 'object' && KEY in state) {
    const id = (state as Record<string, unknown>)[KEY];
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}

/** Trim our picture of history to where the browser actually is. */
function syncToCurrent(): void {
  const cur = currentModalId();
  const i = cur === undefined ? -1 : entries.lastIndexOf(cur);
  // Not one we know — a stale entry a closed sheet left behind (a save that navigated past it):
  // everything we pushed later is above us, so none of it is in history any more.
  entries = entries.slice(0, i + 1);
}

function pushEntry(id: string): void {
  syncToCurrent();
  const state: unknown = window.history.state;
  window.history.pushState({ ...(state && typeof state === 'object' ? state : {}), [KEY]: id }, '');
  entries.push(id);
}

function onPop(): void {
  syncToCurrent();
  const top = live[live.length - 1];
  // The browser left the top modal's entry (Back, a swipe): that modal answers. Landing on its own
  // entry — our own `go` after a UI close — needs nothing.
  if (top && !entries.includes(top.id)) top.onBack();
}

/** Pops the entries of modals closed from the UI — only those on TOP, and only while we are on them. */
function flush(): void {
  flushQueued = false;
  syncToCurrent();
  if (entries.length === 0 || currentModalId() !== entries[entries.length - 1]) return;
  let n = 0;
  while (n < entries.length && !live.some((e) => e.id === entries[entries.length - 1 - n])) n += 1;
  if (n === 0) return;
  entries = entries.slice(0, entries.length - n);
  window.history.go(-n);
}

/** A modal opened: push its entry. `onBack` runs when the browser leaves it (Back / swipe). */
export function openModalEntry(onBack: () => void): string {
  if (!listening) {
    window.addEventListener('popstate', onPop);
    listening = true;
  }
  nextId += 1;
  const id = `m${nextId}`;
  live.push({ id, onBack });
  pushEntry(id);
  return id;
}

/** Back was refused (a changed form, a required dialog): put the entry back under the sheet. */
export function restoreModalEntry(id: string): void {
  pushEntry(id);
}

/** Back already left this entry: forget the modal without popping anything. */
export function dropModalEntry(id: string): void {
  const i = live.findIndex((e) => e.id === id);
  if (i >= 0) live.splice(i, 1);
}

/** The modal closed from the UI: take its entry out of history (batched — one jump per commit). */
export function closeModalEntry(id: string): void {
  const i = live.findIndex((e) => e.id === id);
  if (i < 0) return;
  live.splice(i, 1);
  if (!flushQueued) {
    flushQueued = true;
    queueMicrotask(flush);
  }
}

/**
 * Does this input event change a FORM? A search box and a tick in a picker are not work worth a
 * «Скасувати зміни?» on a backdrop tap.
 */
export function isFormEdit(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return !target.readOnly;
  if (target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !target.readOnly && !['search', 'checkbox', 'radio', 'file', 'range', 'button'].includes(target.type);
  }
  return false;
}
