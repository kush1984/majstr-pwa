import { describe, it, expect } from 'vitest';
import { zipSync } from 'fflate';
import {
  classifyDoc,
  classifyName,
  classifyPageText,
  extract7z,
  extractZipEntries,
  floorFromName,
  floorFromRoomName,
  isDocEntry,
  listZipEntries,
} from './projectDocs.ts';

// Filenames from the REAL designer archive that shaped this feature.
describe('classifyName — the structured designer filenames', () => {
  it.each([
    ['1_обмірний план 1п.pdf', 'PLAN_MEASURE', '1'],
    ['3_експлікація 1п.pdf', 'ROOM_SCHEDULE', '1'],
    ['4_експлікація 2п.pdf', 'ROOM_SCHEDULE', '2'],
    ['42_специфікація покриттів.pdf', 'COVERINGS', null],
    ['специфікація покриття стін і підлог.pdf', 'COVERINGS', null],
    ['24_вимикачи і розетки 1п.pdf', 'ELECTRICAL', '1'],
    ['20_елементи освітлення 1п.pdf', 'ELECTRICAL', '1'],
    ['план меблів 2 поверх.pdf', 'OTHER', '2'],
    ['12_розгортки санвузол.pdf', 'OTHER', null],
    ['тепла підлога 1п.pdf', 'OTHER', '1'],
    ['відомість дверей.pdf', 'OTHER', null],
    ['фото обʼєкта.jpg', 'OTHER', null],
  ])('%s → %s (floor %s)', (name, kind, floor) => {
    expect(classifyName(name)).toEqual({ kind, floor });
  });

  it('reads verbose and special floor labels', () => {
    expect(floorFromName('обмірний план 2 поверх.pdf')).toBe('2');
    expect(floorFromName('експлікація цокольний поверх.pdf')).toBe('цоколь');
    expect(floorFromName('план мансарди.pdf')).toBe('мансарда');
    // «1 підлога» must NOT read as floor 1п.
    expect(floorFromName('специфікація 1 підлога.pdf')).toBeNull();
  });

  it('ticks only the kinds the import can use', () => {
    expect(classifyDoc('експлікація 1п.pdf').useful).toBe(true);
    expect(classifyDoc('обмірний план.pdf').useful).toBe(true);
    expect(classifyDoc('план меблів.pdf').useful).toBe(false);
    expect(classifyDoc('розетки 1п.pdf').useful).toBe(false);
  });
});

describe('floorFromRoomName — a floor written in the room name itself', () => {
  it.each([
    ['Коридор 2 поверху', '2'],
    ['Коридор 2-го поверху', '2'],
    ['санвузол (2п)', '2'],
    ['Спальня 1 поверх', '1'],
    ['Мансарда', 'мансарда'],
    ['цокольний хол', 'цоколь'],
    ['Коридор', null],
    ['Спальня 2', null], // a room number, not a floor
  ])('%s → %s', (name, floor) => {
    expect(floorFromRoomName(name)).toBe(floor);
  });
});

// Stamps copied VERBATIM from Belgradska_1405.pdf — the 25-sheet set that broke
// the feature: one plan sheet, and the rooms table repeated on ten others.
describe('classifyPageText — per-page stamps of a bound multi-sheet PDF', () => {
  it.each([
    ['ОБМІРНИЙ ПЛАН А-03 вул. Бєлградська Обмірний план Специфікація приміщень (обміри) № Приміщення Площа', 'PLAN_MEASURE', null],
    ['ВІДОМІСТЬ КРЕСЛЕНЬ А-02 А-01 ТИТУЛЬНИЙ ЛИСТ А-03 ОБМІРНИЙ ПЛАН А-04 ПЛАН ДЕМОНТАЖУ', 'OTHER', null],
    ['ПЛАН ЧОРНОВОГО ОЗДОБЛЕННЯ СТІН А-08 Специфікація приміщень', 'OTHER', null],
    ['ПЛАН МЕБЛІВ А-09 Специфікація приміщень', 'OTHER', null],
    ['Обмірний план приміщень 1 поверх М 1:50', 'PLAN_MEASURE', '1'],
    ['ЕКСПЛІКАЦІЯ ПРИМІЩЕНЬ  № Назва Площа', 'ROOM_SCHEDULE', null],
    ['Специфікація покриття стін і підлог', 'COVERINGS', null],
    ['План розеток 2 поверх', 'ELECTRICAL', '2'],
  ])('%s → %s (floor %s)', (text, kind, floor) => {
    expect(classifyPageText(text.toLowerCase())).toEqual({ kind, floor });
  });

  it('a coverings spec is recognised but NEVER ticked — it yields no per-room measurements', () => {
    expect(classifyDoc('42_специфікація покриттів.pdf')).toMatchObject({
      kind: 'COVERINGS', useful: false,
    });
  });
});

describe('7z (lazy wasm)', () => {
  it('extracts document entries from a real 7z archive', async () => {
    // Build a genuine 7z with the same wasm, then run it through extract7z.
    const { default: SevenZip } = await import('7z-wasm');
    const sz = await SevenZip({ print: () => {}, printErr: () => {} });
    sz.FS.mkdir('/in');
    sz.FS.writeFile('/in/експлікація 1п.pdf', new TextEncoder().encode('%PDF-seven'));
    sz.FS.writeFile('/in/render.txt', new TextEncoder().encode('noise'));
    sz.callMain(['a', '/out.7z', '/in/експлікація 1п.pdf', '/in/render.txt']);
    const archive = sz.FS.readFile('/out.7z') as Uint8Array;

    const out = await extract7z(archive);

    const names = Object.keys(out);
    expect(names).toHaveLength(1); // the .txt noise is filtered out
    expect(names[0]).toContain('експлікація 1п.pdf');
    expect(new TextDecoder().decode(out[names[0]])).toBe('%PDF-seven');
  }, 30_000);
});

describe('zip handling', () => {
  const zip = zipSync({
    'проєкт/експлікація 1п.pdf': new TextEncoder().encode('%PDF-fake'),
    'проєкт/план меблів.pdf': new TextEncoder().encode('%PDF-fake2'),
    '__MACOSX/._junk.pdf': new Uint8Array([1]),
    'проєкт/render.txt': new TextEncoder().encode('noise'),
  });

  it('lists entries without extracting, and filters non-doc entries', () => {
    const names = listZipEntries(zip).map((e) => e.name);
    expect(names).toContain('проєкт/експлікація 1п.pdf');
    const docNames = names.filter(isDocEntry);
    expect(docNames).toEqual(['проєкт/експлікація 1п.pdf', 'проєкт/план меблів.pdf']);
  });

  it('extracts ONLY the selected entries', () => {
    const out = extractZipEntries(zip, new Set(['проєкт/експлікація 1п.pdf']));
    expect(Object.keys(out)).toEqual(['проєкт/експлікація 1п.pdf']);
    expect(new TextDecoder().decode(out['проєкт/експлікація 1п.pdf'])).toBe('%PDF-fake');
  });
});
