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
  if (n.includes('цокол')) return 'цоколь';
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
    for (const n of sz.FS.readdir(dir) as string[]) {
      if (n === '.' || n === '..') continue;
      const p = `${dir}/${n}`;
      const st = sz.FS.stat(p);
      if (sz.FS.isDir(st.mode)) {
        walk(p);
        continue;
      }
      if (++entries > MAX_ZIP_ENTRIES) throw new Error('zip-too-many-entries');
      if (isDocEntry(p) && st.size <= MAX_ENTRY_BYTES) {
        out[p.slice('/x/'.length)] = sz.FS.readFile(p) as Uint8Array;
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
export function classifyPageText(text: string): { kind: DocKind; floor: string | null } {
  const n = text.toLowerCase();
  const floor = floorFromName(n);
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

/**
 * The text of every page of a PDF (pdfjs-dist, lazy). Pages without a text
 * layer come back as '' — the master assigns those by hand.
 */
export async function pdfPageTexts(buf: ArrayBuffer): Promise<string[]> {
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
