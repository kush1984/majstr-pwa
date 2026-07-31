import { unzipSync } from 'fflate';

/**
 * Client-side triage of a designer's documentation folder. Filenames are
 * structured («3_експлікація 1п.pdf», «42_специфікація покриттів.pdf»), so the
 * type and floor are classified HERE, before anything is uploaded — of a real
 * 45-file archive only the ~5 useful sheets ever leave the phone.
 */

export type DocKind = 'ROOM_SCHEDULE' | 'PLAN_MEASURE' | 'COVERINGS' | 'ELECTRICAL' | 'OTHER';

export interface ClassifiedDoc {
  /** Entry name inside the zip, or the picked file's name. */
  name: string;
  kind: DocKind;
  /** Floor label read from the NAME («1п» → «1») — never from a table inside. */
  floor: string | null;
  /** Ticked by default — the kinds the import can actually use. */
  useful: boolean;
}

/** «1п» / «1 поверх» / «2-го поверху» / «цоколь» / «мансарда» out of a filename. */
export function floorFromName(name: string): string | null {
  const n = name.toLowerCase();
  // «цоколь» is two different words. On a lighting or kitchen sheet it is a lamp base («цоколь
  // Е27») or the plinth under the cabinets («в зоні цоколя») — found exactly that on a real
  // electrical page, which put every room on it onto a basement floor that does not exist. A floor
  // is only meant when it reads like one: «цокольний поверх», «цоколь 1п», a bare «цоколь».
  if (/цокольн|цоколь\s*(поверх|$|[,.)\-–])/u.test(n)) return 'цоколь';
  if (n.includes('мансард')) return 'мансарда';
  if (n.includes('підвал')) return 'підвал';
  const full = n.match(/(\d+)(?:\s*-?\s*|-го\s+)поверх/u);
  if (full) return full[1];
  // «1п» — the digit+п suffix, but not the «п» of a following word («1 підлога»).
  const short = n.match(/(\d+)\s*п(?![а-яіїєґa-z])/u);
  return short ? short[1] : null;
}

/**
 * Floor named INSIDE a room's own name («Коридор 2 поверху», «санвузол (2п)»,
 * «мансарда») — the strongest signal there is: one document routinely lists BOTH
 * floors, so a file-level floor must never override this. The room name is kept
 * as-is (the master recognises it).
 */
export function floorFromRoomName(roomName: string): string | null {
  const n = roomName.toLowerCase();
  if (n.includes('цокол')) return 'цоколь';
  if (n.includes('мансард')) return 'мансарда';
  if (n.includes('підвал')) return 'підвал';
  const verbose = n.match(/(\d+)(?:-го)?\s*поверх/u);
  if (verbose) return verbose[1];
  const bracket = n.match(/\((\d+)\s*п\.?\)/u);
  return bracket ? bracket[1] : null;
}

export function classifyName(name: string): { kind: DocKind; floor: string | null } {
  const n = name.toLowerCase();
  const floor = floorFromName(name);
  if (/обмір/.test(n)) return { kind: 'PLAN_MEASURE', floor };
  if (/експлікац|специфікація приміщень/.test(n)) return { kind: 'ROOM_SCHEDULE', floor };
  // Electrical sheets are a SEPARATE (parked) step — flagged so the UI can say so.
  if (/розет|вимикач|освітлен|електр/.test(n)) return { kind: 'ELECTRICAL', floor };
  // Known noise: furniture, elevations, plumbing, door/window schedules, heated floor…
  if (/мебл|розгортк|сантехн|двер|вікон|тепл|демонтаж|монтаж|стел[іь] в|3d|візуаліз|розріз|фасад|план стел/.test(n)) {
    return { kind: 'OTHER', floor };
  }
  if (/специфікац|покритт/.test(n)) return { kind: 'COVERINGS', floor };
  return { kind: 'OTHER', floor };
}

export function classifyDoc(name: string): ClassifiedDoc {
  const { kind, floor } = classifyName(name);
  // COVERINGS is deliberately NOT ticked: a coverings spec yields no per-room
  // measurements — it's shown as skipped with an explanation instead.
  return {
    name,
    kind,
    floor,
    useful: kind === 'ROOM_SCHEDULE' || kind === 'PLAN_MEASURE',
  };
}

// ---- zip handling (client-side, fflate) -------------------------------------

export const MAX_ZIP_ENTRIES = 200;
export const MAX_ENTRY_BYTES = 15 * 1024 * 1024;

const DOC_EXT = /\.(pdf|jpe?g|png|webp)$/i;

/** Names + declared sizes without decompressing anything (the filter never accepts). */
export function listZipEntries(buf: Uint8Array): { name: string; size: number }[] {
  const entries: { name: string; size: number }[] = [];
  unzipSync(buf, {
    filter: (f) => {
      if (!f.name.endsWith('/')) entries.push({ name: f.name, size: f.originalSize ?? 0 });
      return false;
    },
  });
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error('zip-too-many-entries');
  }
  return entries;
}

/** True for entries the import can even consider (by extension). */
export function isDocEntry(name: string): boolean {
  return DOC_EXT.test(name) && !name.includes('__MACOSX');
}

/**
 * Decompress ONLY the selected entries, each capped by its declared size — a
 * zip-bomb entry is refused before inflation. Entry names are used purely as
 * labels (nothing is written to a filesystem, so `..` paths are inert).
 */
export function extractZipEntries(buf: Uint8Array, names: Set<string>): Record<string, Uint8Array> {
  return unzipSync(buf, {
    filter: (f) => names.has(f.name) && (f.originalSize ?? 0) <= MAX_ENTRY_BYTES,
  });
}

/** Basename without the extension — the human label for the review list. */
export function docLabel(name: string): string {
  const base = name.split('/').pop() ?? name;
  return base.replace(/\.[^.]+$/, '');
}

// ---- 7z (lazy wasm — designers routinely send 7z, not zip) ------------------

export const MAX_7Z_BYTES = 100 * 1024 * 1024;

/**
 * Extract a 7z archive fully in the browser (7z-wasm, ~1.5 MB loaded LAZILY only
 * when a .7z is actually dropped) and return the document entries (≤15 MB each).
 * The wasm FS is sandboxed and thrown away — a bomb can only OOM the user's own
 * tab, and the compressed-size cap keeps that unlikely.
 */
export async function extract7z(buf: Uint8Array): Promise<Record<string, Uint8Array>> {
  if (buf.length > MAX_7Z_BYTES) throw new Error('7z-too-large');
  const { default: SevenZip } = await import('7z-wasm');
  // In the browser the wasm binary must come through vite's asset pipeline; under
  // node/vitest emscripten resolves it next to the module by itself.
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const inBrowser = !proc?.env?.VITEST;
  const wasmUrl = inBrowser ? (await import('7z-wasm/7zz.wasm?url')).default : null;
  const sz = await SevenZip({
    print: () => {},
    printErr: () => {},
    ...(wasmUrl ? { locateFile: () => wasmUrl } : {}),
  });
  sz.FS.writeFile('/archive.7z', buf);
  sz.FS.mkdir('/x');
  sz.callMain(['x', '/archive.7z', '-o/x', '-y']);
  const out: Record<string, Uint8Array> = {};
  let entries = 0;
  const walk = (dir: string) => {
    for (const n of sz.FS.readdir(dir)) {
      if (n === '.' || n === '..') continue;
      const p = `${dir}/${n}`;
      const st = sz.FS.stat(p);
      if (sz.FS.isDir(st.mode)) {
        walk(p);
        continue;
      }
      if (++entries > MAX_ZIP_ENTRIES) throw new Error('zip-too-many-entries');
      if (isDocEntry(p) && st.size <= MAX_ENTRY_BYTES) {
        out[p.slice('/x/'.length)] = sz.FS.readFile(p);
      }
    }
  };
  walk('/x');
  return out;
}

// ---- multi-page PDFs: classify PER PAGE (no LLM) ----------------------------

/**
 * Classify one PDF page by its own text (title block / stamp) — the cheap,
 * model-free triage for the real-world «all 25 sheets in one PDF» case.
 *
 * Order matters, verified against a real project set:
 * - the sheet INDEX («Відомість креслень») lists EVERY title — never a plan itself;
 * - the rooms table («Специфікація приміщень») repeats on many sheets (furniture,
 *   floors, electrics…), so the page's own STAMP (обмірний план / план меблів /
 *   план розеток) must win over the table's presence.
 */
/**
 * Which floor the SHEET is, as opposed to a floor mentioned inside a room's name.
 *
 * A whole page is a poisoned haystack: the Дубляни schedule lists a room called «Коридор 2 поверху»,
 * and reading the page as one string put that floor-1 sheet on floor 2 — where it collided with the
 * real floor-2 schedule and one of the two was dropped.
 *
 * The tell is grammatical, and it holds across every real set we have. A title block states the floor
 * in the NOMINATIVE — «Експлікація приміщень 1 поверх», «Обмірний план 3 лист 2 поверх», or standing
 * among the level marks as «… 0.95 1 поверх 3655». A room's name uses the GENITIVE — «Коридор 2
 * поверху». The only genitive a title itself uses is the ordinal «2-го поверху», so that one is
 * accepted too and nothing else is.
 */
export function floorFromStamp(text: string): string | null {
  const n = (text ?? '').toLowerCase();
  // The named floors carry their own guard already (see floorFromName on «цоколь»).
  if (/цокольн|цоколь\s*(поверх|$|[,.)\-–])/u.test(n)) return 'цоколь';
  if (n.includes('мансард')) return 'мансарда';
  if (n.includes('підвал')) return 'підвал';
  const nominative = /(\d+)\s*поверх(?!у)/u.exec(n);
  if (nominative) return nominative[1];
  const ordinal = /(\d+)\s*-?\s*го\s+поверху/u.exec(n);
  return ordinal ? ordinal[1] : null;
}

export function classifyPageText(text: string): { kind: DocKind; floor: string | null } {
  const n = text.toLowerCase();
  const floor = floorFromStamp(n);
  if (/відомість креслень/.test(n)) return { kind: 'OTHER', floor };
  if (/обмірний план|обмірювальний план|план обмірів/.test(n)) return { kind: 'PLAN_MEASURE', floor };
  if (/розет|вимикач|освітлен|електр/.test(n)) return { kind: 'ELECTRICAL', floor };
  if (/план меблів|план демонтажу|схема демонтажу|схема монтажу|план монтажу|план заповнення|план підлог|план стель|план тепл|план розташування|план розміщення|план чорнового|чорнового оздоблення|оздоблення стін|розгортк|сантехн|кондиціонер|вентиля|радіатор|водопостачання|каналізац|відомість/.test(n)) {
    return { kind: 'OTHER', floor };
  }
  if (/специфікація приміщень|експлікація/.test(n)) return { kind: 'ROOM_SCHEDULE', floor };
  if (/специфікація покритт|специфікація покриття/.test(n)) return { kind: 'COVERINGS', floor };
  return { kind: 'OTHER', floor };
}

// ---- evidence: what a page holds, regardless of what we called it -----------

/** Countable signs that a page carries measurement data, used to decide the default ticks. */
export interface PageEvidence {
  /** Dimension chains: four-digit figures, optionally with a thousands space («5 000»). */
  chains: number;
  /** Areas: a decimal followed by м/m — «12,63 м²», «12.63 m2». Both separators occur. */
  areas: number;
  /** A ceiling height in either notation: «H=2850» or a level mark («відмітка стелі 2.93»). */
  heights: boolean;
  /** An opening spec's markings — «Д 01», «ДЗ 02», «В 07» — the authoritative door/window sizes. */
  openingSpec: boolean;
  /** No text layer at all: a raster export. Says nothing about the content — it hides it. */
  raster: boolean;
}

export function pageEvidence(text: string): PageEvidence {
  const t = text ?? '';
  return {
    chains: (t.match(/\d\s?\d{3}(?!\d)/g) ?? []).length,
    areas: (t.match(/\d+[.,]\d{1,2}\s*(м|m)/giu) ?? []).length,
    // `\w` is ASCII-only in JS even under /u, so «відмітк\w*» never matched a Cyrillic ending —
    // it silently made the whole level-mark notation invisible. \S* is the fix, not a shortcut.
    heights: /[HН]\s*[=\-–]?\s*\d{3,4}/u.test(t) || /відмітк\S*\s+(стел|підлог|верх|низ)/iu.test(t),
    openingSpec: /(^|\s)(ДЗ|Д|В)\s?0?\d{1,2}(\s|$)/u.test(t),
    raster: t.trim().length === 0,
  };
}

/**
 * One sheet per kind+floor, and WHICH one is not a detail.
 *
 * A real set carries the same plan twice — before and after remodelling — so this is where the
 * import decides whether it reads the flat that will exist or the walls about to be demolished. The
 * after-sheet claims the slot first; the loser stays in the list, unticked, for the master.
 *
 * Extracted from the picker so the rule that decides what we PAY for can be tested directly against
 * real archives rather than reasoned about inside a component.
 */
export function dedupeBySlot<T extends { kind: DocKind; floor: string | null; useful: boolean; afterRemodel?: boolean }>(
  rows: T[],
): T[] {
  // Only a kind we RECOGNISED can have a twin. Sheets picked on evidence alone are all
  // «OTHER, floor unknown», so treating that as a slot collapsed six distinct candidates into one —
  // on the Solone set that threw away every sheet carrying the areas and the window/door specs, and
  // left a single plan behind.
  const deduped: DocKind[] = ['ROOM_SCHEDULE', 'PLAN_MEASURE'];
  const seen = new Set<string>();
  const ranked = [...rows].sort(
    (a, b) => Number(b.afterRemodel ?? false) - Number(a.afterRemodel ?? false),
  );
  const kept: T[] = [];
  for (const row of ranked) {
    if (!row.useful) continue;
    if (!deduped.includes(row.kind)) {
      kept.push(row);
      continue;
    }
    const slot = `${row.kind}|${row.floor ?? ''}`;
    if (seen.has(slot)) {
      row.useful = false;
      continue;
    }
    seen.add(slot);
    kept.push(row);
  }
  return kept;
}

/**
 * Does this sheet show the layout AFTER remodelling?
 *
 * A real set carries the same plan twice — «Обмірний план приміщень 1 поверх» and «Обмірний план
 * приміщень ПІСЛЯ ПЕРЕПЛАНУВАННЯ 1 поверх» — with identical file names bar a leading number. The
 * after-sheet is the one that matters: it is the flat that will exist, and it is the one whose areas
 * the schedule lists. Sending the before-sheet gives geometry for walls about to be demolished, and
 * those gabarits then fail the area checksum and come out as zeros — which is what happened.
 *
 * Matches «після пер…» rather than the full word on purpose: one of the real sheets is stamped
 * «після перПланування», and a typo in a designer's title block must not decide which plan we read.
 *
 * The other three forms are there because «до/після» is not how most sets put it. A studio more
 * often names the RESULT («планувальне рішення», «проектне рішення», «проектований план») or writes
 * the sheet in Russian («после перепланировки») — and a set that does either used to fall through
 * to the before-sheet, which is the same failure this function exists to prevent. Deliberately NOT
 * matched: «план монтажу»/«план демонтажу», which name the work rather than the resulting layout
 * and carry only the partitions that change.
 */
export function isAfterRemodel(text: string): boolean {
  const t = text ?? '';
  return /після\s+пер/iu.test(t)
    || /после\s+переплан/iu.test(t)
    || /(планувальне|проектне|проєктне)\s+рішення/iu.test(t)
    || /про[єе]ктований\s+план/iu.test(t);
}

/** Whether a page holds enough to be worth a recognition call when nothing classified. */
export function looksLikeData(e: PageEvidence): boolean {
  // A raster page counts: its text layer is missing, not its content, and dropping those silently
  // is how a scanned measure plan became invisible.
  return e.raster || e.chains >= 5 || e.areas >= 3 || e.openingSpec;
}

/**
 * Which rows to tick by default — the classifier as a HINT rather than a verdict.
 *
 * Measured on four real sets: of Belgradska's 25 sheets one classified useful, and of another
 * 19-sheet project NOT ONE did, so the import had nothing to send and did nothing at all. When the
 * names and stamps produce no useful sheet, the evidence on the pages decides instead, capped so a
 * 44-file archive cannot turn into forty recognition calls.
 */
export const MAX_AUTO_PICKS = 6;

export function defaultPicks<T extends { kind: DocKind; useful: boolean; evidence?: PageEvidence }>(
  rows: T[],
): boolean[] {
  const classified = rows.map((r) => r.useful);
  if (classified.some(Boolean)) return classified;
  const scored = rows
    .map((row, index) => ({ index, e: row.evidence, kind: row.kind }))
    // Only sheets we FAILED to classify. A COVERINGS or ELECTRICAL sheet is excluded on purpose,
    // not by accident: the classifier knew what it was, and it cannot produce rooms — spending a
    // recognition call on it would be the deliberate decision reversed by a side effect.
    .filter((r) => r.kind === 'OTHER' && r.e && looksLikeData(r.e))
    // Most evidence first: a sheet with 89 chains beats a title page with one stray figure.
    .sort((a, b) => score(b.e!) - score(a.e!))
    .slice(0, MAX_AUTO_PICKS)
    .map((r) => r.index);
  return rows.map((_, i) => scored.includes(i));
}

function score(e: PageEvidence): number {
  return e.chains + e.areas * 3 + (e.heights ? 10 : 0) + (e.openingSpec ? 8 : 0);
}


/**
 * The text of every page of a PDF (pdfjs-dist, lazy). Pages without a text
 * layer come back as '' — the master assigns those by hand.
 */
/**
 * How long a single PDF's text extraction may take before we give up on it.
 *
 * pdfjs does not promise to REJECT on a file it cannot make sense of — on a truncated or corrupt
 * PDF it can simply never settle, and every caller here `await`s it. That is not a theoretical
 * risk: it is why the import sheet could sit on «Обрати файли» doing nothing at all, with no error
 * and no way forward, and it is what made one suite test fail about one run in three.
 *
 * A bound turns "hangs forever" into "this sheet has no text layer", which every caller already
 * handles — the file is still listed, still tickable, still classified by its name.
 */
const PDF_TEXT_TIMEOUT_MS = 10_000;
// 10 s, and the number was measured rather than picked. Reading a text layer does no rasterising,
// so even a 40-page set is normally under a second — but the ceiling has to survive a slow phone,
// which is why it is not the 3 s that proved the diagnosis. It also has to stay BELOW the point
// where a master concludes the app is broken, which is why it is not 30 s.

/** Rejects if `work` has not settled in time, so a hung PDF cannot stall the whole import. */
export async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function pdfPageTexts(buf: ArrayBuffer): Promise<string[]> {
  return withTimeout(readPdfPageTexts(buf), PDF_TEXT_TIMEOUT_MS, 'pdfPageTexts');
}

async function readPdfPageTexts(buf: ArrayBuffer): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc =
    new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const task = pdfjs.getDocument({ data: buf });
  const doc = await task.promise;
  const texts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    try {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      texts.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
    } catch {
      texts.push('');
    }
  }
  await task.destroy();
  return texts;
}
