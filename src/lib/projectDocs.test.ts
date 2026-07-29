import { describe, it, expect } from 'vitest';
import { zipSync } from 'fflate';
import {
  classifyDoc,
  classifyName,
  classifyPageText,
  extract7z,
  extractZipEntries,
  defaultPicks,
  floorFromName,
  floorFromRoomName,
  looksLikeData,
  MAX_AUTO_PICKS,
  pageEvidence,
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
    const archive = sz.FS.readFile('/out.7z');

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

describe('the classifier is a hint, and the page contents decide when it fails', () => {
  // Lifted verbatim from four real projects, because every one of them broke a rule that looked
  // safe in the abstract.
  const BELGRADSKA_P3 = 'H=2850мм 3545 4730 4615 4990 2990 5000 2750 3700 Нпр=2230мм Нпд=900мм '
    + 'Специфікація приміщень (обміри) 7,16 m² 17,69 m² ОБМІРНИЙ ПЛАН';
  const EXAMPLE_HOUSE_P2 = 'Умовні позначення - відмітка стелі - відмітка підлоги - відмітка верха '
    + 'прорізу розміри вказані в міліметрах, відмітки в метрах 2.93 0.00 2.28 0.82 12.63m 4.09m';
  const TITLE_PAGE = "ДИЗАЙН-ПРОЄКТ приватний будинок 2024 Автор проєкту";
  const WINDOWS_SPEC = 'СПЕЦИФІКАЦІЯ ВІКОН В 07 В 08 1500 650 650 1300 1415 1000 2415 2140 2230';

  it('reads the evidence a page carries, whatever we called the page', () => {
    const plan = pageEvidence(BELGRADSKA_P3);
    expect(plan.chains).toBeGreaterThan(5);
    expect(plan.areas).toBeGreaterThan(0);
    expect(plan.heights).toBe(true);
    expect(looksLikeData(plan)).toBe(true);

    // Level marks are heights too — «H=» is one studio's convention, not the only one.
    const marks = pageEvidence(EXAMPLE_HOUSE_P2);
    expect(marks.heights).toBe(true);
    expect(marks.areas).toBeGreaterThan(0);   // dot decimals, not commas

    expect(pageEvidence(WINDOWS_SPEC).openingSpec).toBe(true);
    expect(looksLikeData(pageEvidence(TITLE_PAGE))).toBe(false);
  });

  it('treats a page with NO text layer as a candidate, not as noise', () => {
    // A raster export hides its content; it does not prove there is none. Dropping those silently
    // is how a scanned measure plan became invisible.
    const raster = pageEvidence('   ');
    expect(raster.raster).toBe(true);
    expect(looksLikeData(raster)).toBe(true);
  });

  it('keeps the classifier verdict when ANY sheet classified', () => {
    const picks = defaultPicks([
      { kind: 'OTHER' as const, useful: false, evidence: pageEvidence(BELGRADSKA_P3) },
      { kind: 'PLAN_MEASURE' as const, useful: true, evidence: pageEvidence(TITLE_PAGE) },
    ]);
    expect(picks).toEqual([false, true]);
  });

  it('falls back to the evidence when NOTHING classified — the Solone case', () => {
    // 19 sheets, not one recognised: the import had nothing to send and did nothing at all.
    const picks = defaultPicks([
      { kind: 'OTHER' as const, useful: false, evidence: pageEvidence(TITLE_PAGE) },
      { kind: 'OTHER' as const, useful: false, evidence: pageEvidence(BELGRADSKA_P3) },
      { kind: 'OTHER' as const, useful: false, evidence: pageEvidence(WINDOWS_SPEC) },
    ]);
    expect(picks[0]).toBe(false);
    expect(picks[1]).toBe(true);
    expect(picks[2]).toBe(true);
  });

  it('never ticks a sheet the classifier DID recognise as unable to give rooms', () => {
    // A coverings spec produces material totals, not measurements — that decision predates this
    // fallback and must not be undone by it. Same for electrical sheets (a separate, parked step).
    const picks = defaultPicks([
      { kind: 'COVERINGS' as const, useful: false, evidence: pageEvidence('Плитка 94,5 м² 12,5 м²') },
      { kind: 'ELECTRICAL' as const, useful: false, evidence: pageEvidence(BELGRADSKA_P3) },
    ]);
    expect(picks).toEqual([false, false]);
  });

  it('caps the fallback so a 44-file archive cannot become 44 model calls', () => {
    const many = Array.from({ length: 20 }, () => ({
      kind: 'OTHER' as const,
      useful: false,
      evidence: pageEvidence(BELGRADSKA_P3),
    }));
    expect(defaultPicks(many).filter(Boolean)).toHaveLength(MAX_AUTO_PICKS);
  });

  it('«цоколь» is a floor only when it reads like one', () => {
    // Found on a real lighting sheet: «в зоні цоколя» is the kitchen plinth, and it was putting
    // every room on that page onto a basement floor that does not exist.
    expect(floorFromName('h - в зоні цоколя для побут.техніки')).toBeNull();
    expect(floorFromName('лампа з цоколем Е27')).toBeNull();
    expect(floorFromName('цокольний поверх')).toBe('цоколь');
    expect(floorFromName('обмірний план, цоколь')).toBe('цоколь');
    expect(floorFromName('план цоколь')).toBe('цоколь');
    // The other labels are unambiguous and must keep working.
    expect(floorFromName('мансарда 2п')).toBe('мансарда');
    expect(floorFromName('підвал')).toBe('підвал');
  });

});
