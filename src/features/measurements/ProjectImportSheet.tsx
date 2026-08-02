import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { cn } from '@/lib/cn.ts';
import {
  classifyDoc,
  classifyPageText,
  dedupeBySlot,
  defaultPicks,
  docLabel,
  isAfterRemodel,
  extract7z,
  extractZipEntries,
  isDocEntry,
  listZipEntries,
  MAX_ENTRY_BYTES,
  pageEvidence,
  pdfPageTexts,
  type ClassifiedDoc,
  type DocKind,
  type PageEvidence,
} from '@/lib/projectDocs.ts';
import { extractPdfPages, pdfPageCount } from '@/lib/pdfPages.ts';
import { projectImportApi } from '@/api/projectImport.ts';
import { MEASUREMENTS_KEY } from './useMeasurements.ts';
import {
  buildRoomPackage,
  crossCheck,
  elementValue,
  isLinearKind,
  mergeParses,
  roomItems,
  type MergedImport,
  type MergedRoom,
  type PackageElement,
} from './projectImportMerge.ts';
import type {
  ProjectImportCommitRoom,
  ProjectImportParseResponse,
} from '@/api/types.ts';

type Step = 'source' | 'triage' | 'files' | 'parsing' | 'heights' | 'review';

interface DocRow extends ClassifiedDoc {
  id: number;
  /** Where the bytes come from: a picked file, an entry of a zip/7z, or ONE page of a PDF. */
  file?: File;
  zipName?: string;
  sevenZip?: boolean;
  /** 1-based page of a multi-page PDF — split out client-side before upload. */
  page?: number;
  /** What the page actually holds, independent of what we classified it as. */
  evidence?: PageEvidence;
  /** Sheet stamped «після перепланування» — the layout that will actually exist. */
  afterRemodel?: boolean;
  /** Extracted text, kept so the whole set can be triaged in ONE call before anything is read. */
  text?: string;
  /** The sheet's own title, as the model read it — shown instead of a file name when we have it. */
  title?: string;
}

interface RoomRow {
  key: string;
  name: string;
  floor: string | null;
  areaM2: number | null;
  confidence: string;
  notes: string[];
  /** The room's package (v2): real per-element geometry, each independently editable. */
  elements: PackageElement[];
  /** The merged room this was seeded from — lets «take anyway» rebuild the whole package. */
  src: MergedRoom;
  /** Gabarits the model DID read but the checksum refused — shown, never silently dropped. */
  rejected: { widthMm: number; lengthMm: number } | null;
  /** Field names read but unconfirmed — named on the card so he knows WHAT to re-measure. */
  uncertain: string[];
}

const IMPORT_KINDS: DocKind[] = ['ROOM_SCHEDULE', 'PLAN_MEASURE', 'COVERINGS'];
/** Recognition batch cap — per run, not per PDF (a 45-sheet set is picked page-by-page). */
const MAX_SELECTED = 10;

/**
 * «Імпорт проєкту»: the master drops the designer's folder as-is (zip / PDFs /
 * photos). Classification by FILENAME happens right here — of a 45-file archive
 * only the ticked ~5 sheets are uploaded, one parse call each. The results are
 * merged by room number/name, the floor comes from the file name (schedules
 * repeat identically per sheet), missing ceiling heights are asked ONCE per
 * floor, and every room becomes a PACKAGE of measurements the master reviews.
 */
export function ProjectImportSheet({
  open,
  onClose,
  objectId,
  initialFiles,
}: {
  open: boolean;
  onClose: () => void;
  objectId: string;
  /**
   * Files handed over by «Розпізнати план чи ескіз» once the recogniser found them to be a printed
   * plan rather than кроки. They are picked up exactly as if the master had chosen them here, so
   * there is ONE conveyor rather than a second copy of it living on the sketch screen.
   */
  initialFiles?: File[] | null;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('source');
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [progress, setProgress] = useState('');
  const [merged, setMerged] = useState<MergedImport | null>(null);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [heights, setHeights] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  /** What the auto-pick actually parsed — shown on the review so it's never a black box. */
  /** True when the default ticks came from page CONTENTS, because no name or stamp matched. */
  const [guessed, setGuessed] = useState(false);
  const [usedRows, setUsedRows] = useState<DocRow[]>([]);
  const pickRef = useRef<HTMLInputElement>(null);
  const zips = useRef<Map<string, Uint8Array>>(new Map());
  const sevenFiles = useRef<Map<string, Uint8Array>>(new Map());
  const seq = useRef(0);
  const [makeCeilings, setMakeCeilings] = useState(false);
  const [movingRooms, setMovingRooms] = useState<Set<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState('');

  const reset = () => {
    setStep('source');
    setDocs([]);
    setMerged(null);
    setRooms([]);
    setHeights({});
    setSaving(false);
    setMakeCeilings(false);
    setMovingRooms(new Set());
    setMoveTarget('');
    setUsedRows([]);
    setGuessed(false);
    zips.current.clear();
    sevenFiles.current.clear();
  };
  const close = () => {
    reset();
    onClose();
  };

  // ---- step 1: pick files -----------------------------------------------------

  /** Rows for one PDF: single-page as-is; multi-page → a row PER PAGE, classified by
   *  the page's own text (title block / stamp) — no LLM, and no «up to 5 pages» wall. */
  const pdfRows = async (file: File): Promise<DocRow[]> => {
    const pages = await pdfPageCount(file);
    let texts: string[] = [];
    try {
      texts = await pdfPageTexts(await file.arrayBuffer());
    } catch {
      texts = new Array<string>(Math.max(pages, 1)).fill('');
    }
    if (pages <= 1) {
      // A one-page file is classified by its NAME, but it still gets its evidence read: designers
      // send single-sheet PDFs by the dozen («13_підлоги 1п.pdf»), and when a name says nothing the
      // page contents are the only thing left to tick by.
      return [{
        id: seq.current++,
        ...classifyDoc(file.name),
        file,
        evidence: pageEvidence(texts[0] ?? ''),
        text: texts[0] ?? '',
      }];
    }
    const nameFloor = classifyDoc(file.name).floor;
    return texts.map((text, i) => {
      const cls = text.trim() ? classifyPageText(text) : { kind: 'OTHER' as DocKind, floor: null };
      const evidence = pageEvidence(text);
      return {
        id: seq.current++,
        name: file.name,
        kind: cls.kind,
        floor: cls.floor ?? nameFloor,
        // COVERINGS is never ticked — it yields no per-room measurements (shown as skipped).
        useful: cls.kind === 'ROOM_SCHEDULE' || cls.kind === 'PLAN_MEASURE',
        file,
        page: i + 1,
        evidence,
        text,
      };
    });
  };

  /**
   * Read the STAMP of the archive entries that matter.
   *
   * An entry arrives as a file name and nothing else, and a name cannot tell «Обмірний план 1
   * поверх» from «Обмірний план ПІСЛЯ ПЕРЕПЛАНУВАННЯ 1 поверх» — a real set carries both, with
   * identical names bar a leading number. Sending the wrong one imports walls that are about to be
   * demolished, whose gabarits then fail the area checksum and land as zeros.
   *
   * Only the candidate sheets are opened (six of forty-four on a real archive), so this is a few
   * small single-page PDFs, not the whole set.
   */
  const readArchiveStamps = async (rows: DocRow[]) => {
    for (const row of rows) {
      if (!row.useful || row.file) continue;
      try {
        const blob = await bytesOf(row);
        const texts = await pdfPageTexts(await blob.arrayBuffer());
        const text = texts.join(' ');
        if (!text.trim()) continue;
        row.evidence = pageEvidence(text);
        row.afterRemodel = isAfterRemodel(text);
        row.text = text;
        // The sheet's own stamp outranks its file name — our own prompt says so to the model, and
        // the same has to hold here, where the decision about WHICH sheet to send is made.
        const stamp = classifyPageText(text);
        if (stamp.kind !== 'OTHER') row.kind = stamp.kind;
        // FILL a missing floor, never overwrite one the file name already gave: «експлікація 1п» is
        // a stronger statement than anything the page's own prose can be trusted for.
        if (stamp.floor && !row.floor) row.floor = stamp.floor;
      } catch {
        // A stamp we cannot read changes nothing: the name-based classification stands.
      }
    }
  };

  /**
   * Let the MODEL say what these sheets are — one cheap text call for the whole set.
   *
   * This is what decides the ticks now. The keyword lists that used to decide were written from the
   * projects we happened to have: eight Ukrainian patterns, nothing Russian or English, and a sheet
   * matching none of them was never sent at all. They remain as the fallback below, for a set with no
   * text layer, an offline pick, or a call that fails — never as the primary answer.
   */
  const triage = async (rows: DocRow[]): Promise<boolean> => {
    const withText = rows.filter((r) => (r.text ?? '').trim().length > 0);
    if (withText.length === 0) return false;
    try {
      const results = await projectImportApi.triage(objectId, withText.slice(0, 60).map((r) => ({
        id: String(r.id), name: r.name, text: (r.text ?? '').slice(0, 6000),
      })));
      if (results.length === 0) return false;
      const byId = new Map(results.map((x) => [x.id, x]));
      for (const row of rows) {
        const verdict = byId.get(String(row.id));
        if (!verdict) continue;
        row.kind = verdict.kind;
        // The sheet's own floor, from its title block. Ours came from a file name, which is a
        // weaker statement — but an empty answer must not erase it.
        if (verdict.floor) row.floor = verdict.floor;
        row.afterRemodel = verdict.version === 'AFTER';
        row.title = verdict.title ?? undefined;
        row.useful = verdict.worthReading;
      }
      return true;
    } catch {
      // Offline, unconfigured, or refused: the keyword classification we already have stands. The
      // import must not become unusable because a triage call could not be made.
      return false;
    }
  };

  // FileList from the input, File[] when handed over from the sketch screen — both spread the same.
  const onPick = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const rows: DocRow[] = [];
    try {
      for (const file of [...files]) {
        if (/\.zip$/i.test(file.name)) {
          const buf = new Uint8Array(await file.arrayBuffer());
          zips.current.set(file.name, buf);
          for (const entry of listZipEntries(buf)) {
            if (!isDocEntry(entry.name)) continue;
            if (entry.size > MAX_ENTRY_BYTES) continue; // a bomb-sized entry never inflates
            rows.push({ id: seq.current++, ...classifyDoc(entry.name), zipName: file.name });
          }
        } else if (/\.7z$/i.test(file.name)) {
          // Designers routinely send 7z — unpacked right here (wasm loads lazily).
          try {
            const out = await extract7z(new Uint8Array(await file.arrayBuffer()));
            for (const [name, data] of Object.entries(out)) {
              sevenFiles.current.set(name, data);
              rows.push({ id: seq.current++, ...classifyDoc(name), sevenZip: true });
            }
          } catch (e) {
            toast.error(t((e as Error).message === '7z-too-large'
              ? 'projectImport.archiveTooLarge'
              : 'projectImport.sevenZipFailed'));
          }
        } else if (/\.pdf$/i.test(file.name)) {
          rows.push(...await pdfRows(file));
        } else {
          // A PHOTO. It carries no text layer and its name is a camera's («IMG20260510130144»), so
          // every signal the picker normally reads is absent: triage skips it for having no text,
          // and defaultPicks skipped it for having no evidence at all — which left the master with
          // «Розпізнаю 0 із 1 файлів» and a disabled button over the plan he had just photographed.
          //
          // Nothing here can judge the picture, and a file the master chose one at a time, looking
          // at it, is not a file he wants excluded. So it is ticked, and its evidence says what is
          // actually true: no text layer.
          rows.push({
            id: seq.current++,
            ...classifyDoc(file.name),
            useful: true,
            evidence: pageEvidence(''),
            file,
          });
        }
      }
    } catch {
      toast.error(t('projectImport.zipFailed'));
      return;
    }
    if (rows.length === 0) {
      toast.error(t('projectImport.nothingUseful'));
      return;
    }
    setStep('triage');
    const triaged = await triage(rows);
    if (!triaged) {
      // The classifier is a HINT. When no name or stamp matched anything — a whole real 19-sheet
      // project — the ticks come from what the pages actually carry instead, so the master gets a
      // list with something on it rather than an empty screen and no reason why.
      const picks = defaultPicks(rows);
      rows.forEach((row, i) => {
        row.useful = picks[i];
      });
      await readArchiveStamps(rows);
    }
    // Only a guess needs confirming. When the model classified the sheets, its answer stands.
    const byEvidenceOnly = !triaged && !rows.some((r) => IMPORT_KINDS.includes(r.kind) && r.useful);
    setGuessed(byEvidenceOnly);
    setDocs(rows);
    // The master shouldn't have to hunt for the measure sheet in a 25-page set: when the
    // classifier found the useful page(s) unambiguously, parse them straight away. The
    // file list is the FALLBACK (nothing found, or too many) — and the review screen keeps
    // a «взяти інші сторінки» way back.
    // One sheet per KIND+FLOOR: a real set often carries near-identical variants
    // («1_обмірний план 1п» and «7_обмірний план 1п») — parsing both costs two LLM
    // calls for the same rooms. The rest stay in the list, unticked, for the master.
    //
    // WHICH one survives is not a detail: those two sheets are the layout before and after
    // remodelling. The after-sheet is the flat that will exist and the one the schedule's areas
    // belong to; taking the before-sheet by list order imported demolished walls, whose gabarits
    // then failed the checksum and came out as zeros. So the after-sheet claims the slot first.
    const auto = dedupeBySlot(rows);
    if (!byEvidenceOnly && auto.length > 0 && auto.length <= MAX_SELECTED) {
      setStep('parsing');
      void runParse(auto);
      return;
    }
    // Picked on evidence alone: show the list, with the evidence, and let him confirm. Spending
    // recognition calls on a guess the master never saw is how «нічого не розпізнало» happens.
    setStep('files');
  };

  // Files handed over from the sketch screen start the same way a manual pick does. Keyed on the
  // array identity, which the parent creates once per handover, so re-renders cannot re-run it; the
  // `step` guard keeps a handover from restarting a pick that is already under way.
  const handedOver = initialFiles ?? null;
  useEffect(() => {
    if (open && handedOver && handedOver.length > 0 && step === 'source') {
      void onPick(handedOver);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, handedOver]);

  const selected = docs.filter((d) => d.useful);

  const setDoc = (id: number, patch: Partial<DocRow>) =>
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  // ---- step 2 → 3: parse the selected ----------------------------------------

  const bytesOf = async (d: DocRow): Promise<Blob> => {
    if (d.page && d.file) {
      // One page of a multi-page set — split client-side so the model never sees
      // (or is billed for) the other 44 sheets.
      return extractPdfPages(d.file, [d.page]);
    }
    if (d.file) return d.file;
    if (d.sevenZip) {
      const data = sevenFiles.current.get(d.name);
      if (!data) throw new Error('entry lost');
      return new Blob([new Uint8Array(data)]);
    }
    const buf = zips.current.get(d.zipName ?? '');
    if (!buf) throw new Error('zip lost');
    const out = extractZipEntries(buf, new Set([d.name]));
    const data = out[d.name];
    if (!data) throw new Error('entry lost');
    return new Blob([new Uint8Array(data)]);
  };

  const runParse = async (rows?: DocRow[]) => {
    const batch = rows ?? selected;
    // Import is online-only by design (LLM round-trips) — refuse clearly, never queue.
    if (!navigator.onLine) {
      toast.error(t('projectImport.needOnline'));
      setStep('files');
      return;
    }
    setStep('parsing');
    setUsedRows(batch);
    const parsed: { fileFloor: string | null; resp: ProjectImportParseResponse }[] = [];
    try {
      let i = 0;
      for (const d of batch) {
        i++;
        setProgress(`${i}/${batch.length} · ${rowLabel(d)}`);
        const blob = await bytesOf(d);
        // Keep the real basename (extension included) — the server sniffs PDFs by
        // magic bytes but resolves image media types from the filename.
        const basename = d.name.split('/').pop() ?? d.name;
        const resp = await projectImportApi.parse(objectId, blob, basename, d.kind);
        parsed.push({ fileFloor: d.floor, resp });
      }
    } catch (err) {
      toast.error(toAppError(err).message);
      setStep('files');
      return;
    }
    const m = mergeParses(parsed);
    setMerged(m);
    const preHeights: Record<string, string> = {};
    for (const label of floorLabels(m)) {
      const mm = m.ceilingHeightsMm[label];
      preHeights[label] = mm ? String(mm / 1000) : '';
    }
    setHeights(preHeights);
    // Ask for a height ONLY when some room actually lacks one (the plan's «H=…» covers
    // the rest) — a full screen for heights we already read would be noise.
    const roomsNeedingHeight = m.rooms.filter(
      (r) => r.ceilingHmm == null && !preHeights[r.floor ?? ''],
    );
    if (roomsNeedingHeight.length > 0) {
      setStep('heights');
    } else {
      buildRooms(m, preHeights);
    }
  };

  const floorLabels = (m: MergedImport): string[] => {
    const labels: string[] = [];
    for (const r of m.rooms) {
      const l = r.floor ?? '';
      if (!labels.includes(l)) labels.push(l);
    }
    return labels;
  };

  // ---- step 4: heights → review ----------------------------------------------

  const heightMmOf = (h: Record<string, string>, floor: string | null): number | null => {
    const raw = (h[floor ?? ''] ?? '').replace(',', '.');
    const v = Number(raw);
    return raw && Number.isFinite(v) && v > 0 ? Math.round(v * 1000) : null;
  };

  const buildRooms = (m: MergedImport, h: Record<string, string>) => {
    setRooms(m.rooms.map((room) => ({
      key: room.key,
      name: room.name,
      floor: room.floor,
      areaM2: room.areaM2,
      confidence: room.confidence,
      uncertain: room.uncertain,
      notes: room.notes,
      elements: buildRoomPackage(room, heightMmOf(h, room.floor)),
      src: room,
      rejected: room.rejected,
    })));
    setStep('review');
  };

  /**
   * The master accepts gabarits the checksum refused («все одно взяти»): re-seed the WHOLE
   * package from them — the floor gets its width×length and all four walls get their runs.
   * Their edits in that room are replaced, which is the point of re-seeding.
   */
  const takeRejected = (roomKey: string) => setRooms((prev) => prev.map((r) => {
    if (r.key !== roomKey || !r.rejected) return r;
    const src = { ...r.src, widthMm: r.rejected.widthMm, lengthMm: r.rejected.lengthMm };
    return {
      ...r,
      elements: buildRoomPackage(src, heightMmOf(heights, r.floor)),
      src,
      rejected: null,
    };
  }));

  /** Edit one element of a room (geometry / enable / take-area). */
  const patchElement = (roomKey: string, elKey: string, patch: Partial<PackageElement>) =>
    setRooms((prev) => prev.map((r) => r.key !== roomKey ? r : {
      ...r,
      elements: r.elements.map((e) => (e.key === elKey ? { ...e, ...patch } : e)),
    }));

  const toggleCeilings = (on: boolean) => {
    setMakeCeilings(on);
    setRooms((prev) => prev.map((r) => ({
      ...r,
      elements: r.elements.map((e) => (e.kind === 'ceiling' ? { ...e, enabled: on } : e)),
    })));
  };

  /** A floor/ceiling with a doc area but no dimensions and not yet taken — the «взяти» targets. */
  const isUntakenArea = (e: PackageElement): boolean =>
    (e.kind === 'floor' || e.kind === 'ceiling') && e.enabled
    && e.areaHintM2 != null && e.aMm == null && e.bMm == null && !e.takeArea;

  const untakenAreas = useMemo(
    () => rooms.reduce((n, r) => n + r.elements.filter(isUntakenArea).length, 0),
    [rooms],
  );

  /** One tap: keep every recognised floor area from the document (opt-in, never forced). */
  const takeAllAreas = () => setRooms((prev) => prev.map((r) => ({
    ...r,
    elements: r.elements.map((e) => (isUntakenArea(e) ? { ...e, takeArea: true } : e)),
  })));

  /** Rooms whose walls still need a height — an explicit report, never silence. */
  const gaps = useMemo(() => {
    const noHeightFloors: string[] = [];
    for (const r of rooms) {
      const wallsNeedHeight = r.elements.some((e) => e.kind === 'wall' && e.enabled && e.aMm != null && e.bMm == null);
      if (wallsNeedHeight) {
        const label = r.floor ?? '';
        if (!noHeightFloors.includes(label)) noHeightFloors.push(label);
      }
    }
    return { noHeightFloors };
  }, [rooms]);

  // Honesty at a glance («Джерела/Відсутнє» in spirit): how complete the import is per source
  // — площа (from the schedule), розміри (checksum-confirmed gabarits), висота (plan H= or the
  // answered floor height). A metric below its total is itself the honest "звірити" signal.
  const coverage = useMemo(() => {
    const rs = merged?.rooms ?? [];
    return {
      total: rs.length,
      withArea: rs.filter((r) => r.areaM2 != null).length,
      withDims: rs.filter((r) => r.widthMm != null).length,
      withHeight: rs.filter((r) => r.ceilingHmm != null || heightMmOf(heights, r.floor) != null).length,
      // Read but refused by the checksum — the single most useful answer to «why zeros?».
      mismatched: rs.filter((r) => r.rejected != null).length,
    };
  }, [merged, heights]);

  // ---- step 5: review + commit ------------------------------------------------

  const removeRoom = (key: string) => setRooms((prev) => prev.filter((r) => r.key !== key));

  const commitRooms: ProjectImportCommitRoom[] = useMemo(() => {
    const out: ProjectImportCommitRoom[] = [];
    for (const r of rooms) {
      const items = roomItems(r.elements);
      if (items.length > 0) {
        out.push({ name: r.name, floor: r.floor, items });
      }
    }
    // A coverings spec deliberately creates NO measurements: its figures are material
    // totals for the whole object, not per-room geometry. It's reported as skipped.
    return out;
  }, [rooms]);

  const totalItems = commitRooms.reduce((s, r) => s + r.items.length, 0);
  const areaSumOver = merged ? crossCheck(merged.rooms, merged.totalAreaM2) : null;

  const commit = async () => {
    if (!navigator.onLine) {
      toast.error(t('projectImport.needOnline'));
      return;
    }
    setSaving(true);
    try {
      await projectImportApi.commit(objectId, { rooms: commitRooms });
      await qc.invalidateQueries({ queryKey: MEASUREMENTS_KEY(objectId) });
      toast.success(t('projectImport.saved', { rooms: commitRooms.length }));
      close();
    } catch (err) {
      toast.error(toAppError(err).message);
      setSaving(false);
    }
  };

  // ---- render ------------------------------------------------------------------

  const kindLabel = (k: DocKind) => t(`projectImport.kind.${k}`);

  return (
    <Modal open={open} onClose={close} title={t('projectImport.title')} size="lg">
      {step === 'source' && (
        <div className="space-y-3">
          <p className="text-sm text-muted">{t('projectImport.sourceHint')}</p>
          <Button fullWidth onClick={() => pickRef.current?.click()}>{t('projectImport.pick')}</Button>
          <input ref={pickRef} type="file" multiple
            accept=".zip,.7z,application/pdf,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => { void onPick(e.target.files); e.target.value = ''; }} />
        </div>
      )}

      {step === 'files' && (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {t('projectImport.filesHint', { n: selected.length, m: docs.length })}
          </p>
          {/* Nothing matched by name or stamp, so the ticks are a guess from the page contents —
              say so, rather than letting him assume the classifier knew what it was doing. */}
          {guessed && (
            <p className="rounded-xl bg-amber-soft p-3 text-xs text-amber">
              {t('projectImport.guessedByEvidence')}
            </p>
          )}

          <div className="max-h-[45vh] space-y-1.5 overflow-y-auto">
            {docs.map((d) => (
              <div key={d.id}
                className={cn('rounded-xl border p-2.5',
                  d.useful ? 'border-brand/40 bg-brand-soft' : 'border-border bg-surface')}>
                <label className="flex cursor-pointer items-center gap-2.5">
                  <input type="checkbox" checked={d.useful}
                    onChange={() => setDoc(d.id, { useful: !d.useful })}
                    className="h-5 w-5 flex-shrink-0 rounded border-border text-brand focus:ring-brand-200" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-primary">
                      {d.title ? `${d.title} · ${rowLabel(d)}` : rowLabel(d)}
                    </span>
                    <span className="block text-[11px] text-muted">
                      {kindLabel(d.kind)}
                      {d.floor && ` · ${t('projectImport.floorLabel', { floor: d.floor })}`}
                      {evidenceNote(d.evidence, t) && ` · ${evidenceNote(d.evidence, t)}`}
                    </span>
                  </span>
                </label>
                {d.useful && (
                  <div className="mt-1.5 flex gap-2 pl-[30px]">
                    <select value={d.kind}
                      onChange={(e) => setDoc(d.id, { kind: e.target.value as DocKind })}
                      className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-primary">
                      {IMPORT_KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
                    </select>
                    <input value={d.floor ?? ''} placeholder={t('projectImport.floorPlaceholder')}
                      onChange={(e) => setDoc(d.id, { floor: e.target.value.trim() || null })}
                      className="w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-primary" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* An honest heads-up about what the SELECTED documents can and cannot give —
              kills the «imported and there are no sizes» disappointment before parsing. */}
          {selected.length > 0 && (
            <div className="rounded-xl bg-surface-sunken p-3 text-xs text-secondary">
              {capabilityNote(selected, t)}
            </div>
          )}

          {/* A ticked sheet is ALWAYS sendable, whatever we called it. Blocking here (and 400-ing
              on the server) punished the master for our classifier being wrong about his own
              drawing — and on sets where nothing classifies, that was every sheet. */}
          <Button fullWidth
            disabled={selected.length === 0 || selected.length > MAX_SELECTED}
            onClick={() => void runParse()}>
            {t('projectImport.recognise', { n: selected.length })}
          </Button>
          {selected.length > MAX_SELECTED && (
            <p className="text-center text-xs text-amber">{t('projectImport.tooManySelected', { max: MAX_SELECTED })}</p>
          )}
        </div>
      )}

      {step === 'triage' && (
        <div className="py-10 text-center">
          <Spinner size="lg" />
          <p className="mt-3 text-sm text-muted">{t('projectImport.triaging')}</p>
          <p className="mt-1 text-xs text-faint">{t('projectImport.triagingHint')}</p>
        </div>
      )}

      {step === 'parsing' && (
        <div className="py-10 text-center">
          <Spinner size="lg" />
          <p className="mt-3 text-sm text-muted">{t('projectImport.parsing')}</p>
          <p className="mt-1 text-xs text-faint">{progress}</p>
        </div>
      )}

      {step === 'heights' && merged && (
        <div className="space-y-3">
          <p className="text-sm text-muted">{t('projectImport.heightsHint')}</p>
          {/* Rooms whose «H=…» the plan already gave are NOT asked about — only the rest. */}
          {merged.rooms.some((r) => r.ceilingHmm != null) && (
            <p className="text-xs text-muted">
              {t('projectImport.heightsFound', {
                n: merged.rooms.filter((r) => r.ceilingHmm != null).length,
              })}
            </p>
          )}
          {floorLabels(merged).map((label) => (
            <div key={label} className="flex items-center gap-3">
              <span className="w-32 text-sm text-primary">
                {label ? t('projectImport.floorLabel', { floor: label }) : t('projectImport.noFloor')}
              </span>
              <Input inputMode="decimal" placeholder="2,7" value={heights[label] ?? ''}
                onChange={(e) => setHeights((p) => ({ ...p, [label]: e.target.value }))} />
              <span className="text-sm text-muted">{t('units.M')}</span>
            </div>
          ))}
          <Button fullWidth onClick={() => buildRooms(merged, heights)}>{t('common.next')}</Button>
          <p className="text-center text-xs text-muted">{t('projectImport.heightsSkipHint')}</p>
        </div>
      )}

      {step === 'review' && merged && (
        rooms.length === 0 && merged.coverings.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted">{t('projectImport.nothing')}</p>
            <Button className="mt-4" variant="secondary" onClick={reset}>{t('sketch.tryAgain')}</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Honesty summary — what was recognised vs what still needs the master, at a glance. */}
            {coverage.total > 0 && (
              <div className="rounded-xl bg-surface-sunken p-3">
                <div className="text-xs font-semibold text-primary">
                  {t('projectImport.coverage.title', { n: coverage.total })}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                  <CoverageMetric label={t('projectImport.coverage.area')} have={coverage.withArea} total={coverage.total} />
                  <CoverageMetric label={t('projectImport.coverage.dims')} have={coverage.withDims} total={coverage.total} />
                  <CoverageMetric label={t('projectImport.coverage.height')} have={coverage.withHeight} total={coverage.total} />
                </div>
                {coverage.mismatched > 0 && (
                  <p className="mt-1.5 text-[11px] text-amber">
                    {t('projectImport.coverage.mismatched', { n: coverage.mismatched })}
                  </p>
                )}
              </div>
            )}
            {(merged.warnings.length > 0 || areaSumOver != null || gaps.noHeightFloors.length > 0) && (
              <div className="rounded-xl bg-amber-soft p-3 text-xs text-amber">
                <ul className="list-disc space-y-0.5 pl-4">
                  {areaSumOver != null && (
                    <li className="font-semibold">
                      {t('projectImport.crossCheck', { sum: areaSumOver, total: merged.totalAreaM2 })}
                    </li>
                  )}
                  {/* Walls still needing a height — an explicit report, never silence. */}
                  {gaps.noHeightFloors.map((label) => (
                    <li key={`h-${label}`} className="font-semibold">
                      {t('projectImport.wallsNoHeight', { floor: label || t('projectImport.noFloor') })}
                    </li>
                  ))}
                  {merged.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
            {/* The auto-pick is never a black box — say which sheet was read, and offer back. */}
            {usedRows.length > 0 && (
              <p className="text-xs text-muted">
                {t('projectImport.autoPicked', { what: usedRows.map(rowLabel).join(', ') })}
                {' · '}
                <button type="button" className="font-semibold text-brand" onClick={() => setStep('files')}>
                  {t('projectImport.pickOther')}
                </button>
              </p>
            )}
            <p className="text-xs text-muted">{t('projectImport.honesty')}</p>

            {/* Floors import EMPTY (the master measures). One tap keeps every recognised area
                from the document instead of clearing it — an opt-in, never forced. */}
            {untakenAreas > 0 && (
              <button type="button" onClick={takeAllAreas}
                className="min-h-[40px] w-full rounded-xl border border-border bg-surface px-3 text-left text-[13px] font-semibold text-brand">
                {t('projectImport.takeAllAreas', { n: untakenAreas })}
              </button>
            )}

            {/* Ceiling = a floor duplicate for rectangular rooms — OFF by default. */}
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={makeCeilings}
                onChange={(e) => toggleCeilings(e.target.checked)}
                className="h-4 w-4 rounded border-border text-brand focus:ring-brand-200" />
              <span className="text-sm text-primary">{t('projectImport.makeCeilings')}</span>
            </label>
            {makeCeilings && <p className="pl-6 text-xs text-muted">{t('projectImport.ceilingsHint')}</p>}

            {/* Mass action: move the ticked rooms to another floor in one go. */}
            {movingRooms.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-brand-soft p-2.5">
                <span className="text-xs text-primary">
                  {t('projectImport.moveSelected', { n: movingRooms.size })}
                </span>
                <input value={moveTarget} placeholder={t('projectImport.floorPlaceholder')}
                  onChange={(e) => setMoveTarget(e.target.value)}
                  className="w-20 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-primary" />
                <button type="button"
                  className="min-h-[36px] rounded-lg bg-brand px-3 text-xs font-semibold text-white"
                  onClick={() => {
                    const target = moveTarget.trim() || null;
                    setRooms((prev) => prev.map((r) => movingRooms.has(r.key) ? { ...r, floor: target } : r));
                    setMovingRooms(new Set());
                    setMoveTarget('');
                  }}>
                  {t('projectImport.moveApply')}
                </button>
              </div>
            )}

            <div className="max-h-[45vh] space-y-3 overflow-y-auto">
              {reviewFloorLabels(rooms).map((label) => {
                const floorRooms = rooms.filter((r) => (r.floor ?? '') === label);
                if (floorRooms.length === 0) return null;
                return (
                  <div key={label} className="space-y-2">
                    {label !== '' || reviewFloorLabels(rooms).length > 1 ? (
                      <div className="text-[11px] font-bold uppercase tracking-wide text-brand">
                        {label ? t('projectImport.floorLabel', { floor: label }) : t('projectImport.noFloor')}
                      </div>
                    ) : null}
                    {floorRooms.map((room) => (
                      <div key={room.key}
                        className={cn('rounded-xl border p-3',
                          room.confidence !== 'high' ? 'border-amber-400 bg-amber-soft' : 'border-border bg-surface')}>
                        <div className="flex items-center gap-2">
                          <input type="checkbox" checked={movingRooms.has(room.key)}
                            aria-label={t('projectImport.selectRoom')}
                            onChange={() => setMovingRooms((prev) => {
                              const next = new Set(prev);
                              if (next.has(room.key)) next.delete(room.key); else next.add(room.key);
                              return next;
                            })}
                            className="h-4 w-4 flex-shrink-0 rounded border-border text-brand focus:ring-brand-200" />
                          <Input value={room.name} className="flex-1"
                            onChange={(e) => setRooms((p) => p.map((x) => x.key === room.key ? { ...x, name: e.target.value } : x))} />
                          <input value={room.floor ?? ''} placeholder={t('projectImport.floorPlaceholder')}
                            aria-label={t('projectImport.floorPlaceholder')}
                            onChange={(e) => setRooms((p) => p.map((x) => x.key === room.key
                              ? { ...x, floor: e.target.value.trim() || null } : x))}
                            className="w-16 rounded-lg border border-border bg-surface px-2 py-2 text-sm text-primary" />
                          <button type="button" aria-label={t('common.delete')} className="px-1 text-muted"
                            onClick={() => removeRoom(room.key)}>🗑</button>
                        </div>
                        {/* Sizes the model DID read but the checksum refused (their product
                            doesn't match the table area). Never silently dropped — showing them
                            is what turns «why is everything zero?» into a decision. */}
                        {room.rejected && (
                          <p className="mt-1.5 rounded-lg bg-amber-soft px-2 py-1.5 text-xs text-amber">
                            {t('projectImport.rejectedHint', {
                              w: (room.rejected.widthMm / 1000).toLocaleString('uk-UA'),
                              l: (room.rejected.lengthMm / 1000).toLocaleString('uk-UA'),
                              area: (room.areaM2 ?? 0).toLocaleString('uk-UA'),
                            })}
                            {' '}
                            <button type="button" className="font-semibold underline"
                              onClick={() => takeRejected(room.key)}>
                              {t('projectImport.rejectedTake')}
                            </button>
                          </p>
                        )}

                        {/* Every element is a REAL shape with visible fields — floor/ceiling and
                            each of the 4 walls carry width×… ; plinth/reveals a plain length. */}
                        <div className="mt-2 space-y-1.5">
                          {room.elements.map((e) => (
                            <ElementEditor key={e.key} el={e} t={t}
                              onChange={(patch) => patchElement(room.key, e.key, patch)} />
                          ))}
                        </div>
                        {/* Named, not merely coloured: «перепровірити: ширина, висота стелі» tells
                            him which tape measurement settles it. The figures themselves stay in
                            the fields above — that is the whole point of keeping them. */}
                        {room.uncertain.length > 0 && (
                          <p className="mt-1.5 rounded-lg bg-amber-soft px-2 py-1.5 text-xs text-amber">
                            <span className="font-semibold">{t('projectImport.recheck')}</span>
                            {': '}
                            {room.uncertain.map((f) => fieldLabel(f, t)).join(', ')}
                          </p>
                        )}
                        {(room.notes.length > 0) && (
                          <p className="mt-1.5 text-xs text-amber">{room.notes.join(' · ')}</p>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}

              {/* Coverings are REPORTED, not imported — material totals aren't measurements. */}
              {merged.coverings.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-muted">
                    {t('projectImport.coveringsTitle')}
                  </div>
                  <p className="text-xs text-muted">{t('projectImport.coveringsSkipped')}</p>
                  {merged.coverings.map((c, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-muted">{c.name}</span>
                      <span className="whitespace-nowrap text-sm text-muted">
                        {c.qty.toLocaleString('uk-UA')} {t(c.unit === 'M2' ? 'units.M2' : 'units.LINEAR_METER')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Button fullWidth loading={saving} disabled={commitRooms.length === 0}
              onClick={() => void commit()}>
              {t('projectImport.add', { rooms: commitRooms.length, items: totalItems })}
            </Button>
          </div>
        )
      )}
    </Modal>
  );
}

/**
 * One element of a room's package on the review card — real, editable geometry.
 * A surface (floor / ceiling / each wall) shows a×b fields (EMPTY = "measure on
 * site", never a hidden dead end); a floor/ceiling with only a document area
 * offers a one-tap «взяти площу»; plinth/reveals a single running length.
 */
function ElementEditor({
  el, t, onChange,
}: {
  el: PackageElement;
  t: (k: string, o?: Record<string, unknown>) => string;
  onChange: (patch: Partial<PackageElement>) => void;
}) {
  const isLinear = isLinearKind(el.kind);
  const value = elementValue(el);
  const unitKey = isLinear ? 'units.LINEAR_METER' : 'units.M2';

  const mmShown = (mm: number | null) => (mm == null ? '' : String(Math.round(mm) / 1000));
  const toMm = (raw: string): number | null => {
    const v = Number(raw.replace(',', '.').trim());
    return raw.trim() && Number.isFinite(v) && v > 0 ? Math.round(v * 1000) : null;
  };
  const labels = el.kind === 'wall'
    ? { a: t('projectImport.el.length'), b: t('projectImport.el.height') }
    : { a: t('projectImport.el.width'), b: t('projectImport.el.length') };

  return (
    <div className={cn('rounded-lg border p-2',
      el.enabled ? 'border-border bg-surface' : 'border-dashed border-border bg-surface-sunken')}>
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={el.enabled} aria-label={el.name}
          onChange={() => onChange({ enabled: !el.enabled })}
          className="h-4 w-4 flex-shrink-0 rounded border-border text-brand focus:ring-brand-200" />
        <span className="flex-1 text-sm font-medium text-primary">{el.name}</span>
        <span className="whitespace-nowrap text-sm font-semibold text-primary">
          {value > 0 ? value.toLocaleString('uk-UA') : '—'} {t(unitKey)}
        </span>
      </div>

      {el.enabled && (
        <div className="mt-1.5 pl-6">
          {isLinear ? (
            <label className="flex items-center gap-2">
              <span className="text-xs text-muted">{t('projectImport.el.length')}</span>
              <input inputMode="decimal" value={el.lengthM == null ? '' : String(el.lengthM)}
                aria-label={t('projectImport.el.length')}
                onChange={(e) => {
                  const raw = e.target.value.replace(',', '.').trim();
                  const v = Number(raw);
                  onChange({ lengthM: raw && Number.isFinite(v) && v > 0 ? Math.round(v * 1000) / 1000 : null });
                }}
                className="w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-primary" />
              <span className="text-xs text-muted">{t('units.M')}</span>
            </label>
          ) : el.takeArea ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted">
                {t('projectImport.el.areaTaken', { area: (el.areaHintM2 ?? 0).toLocaleString('uk-UA') })}
              </span>
              <button type="button" className="font-semibold text-brand"
                onClick={() => onChange({ takeArea: false })}>
                {t('projectImport.el.enterDims')}
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <input inputMode="decimal" value={mmShown(el.aMm)} aria-label={labels.a} placeholder={labels.a}
                  onChange={(e) => onChange({ aMm: toMm(e.target.value) })}
                  className="w-20 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-primary" />
                <span className="text-xs text-faint">×</span>
                <input inputMode="decimal" value={mmShown(el.bMm)} aria-label={labels.b} placeholder={labels.b}
                  onChange={(e) => onChange({ bMm: toMm(e.target.value) })}
                  className="w-20 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-primary" />
                <span className="text-xs text-muted">{t('units.M')}</span>
              </div>
              {/* A floor/ceiling whose gabarits weren't read: the doc area is one tap away. */}
              {(el.kind === 'floor' || el.kind === 'ceiling')
                && el.areaHintM2 != null && el.aMm == null && el.bMm == null && (
                <p className="mt-1 text-xs text-muted">
                  {t('projectImport.el.areaHint', { area: el.areaHintM2.toLocaleString('uk-UA') })}
                  {' '}
                  <button type="button" className="font-semibold text-brand"
                    onClick={() => onChange({ takeArea: true })}>
                    {t('projectImport.el.takeArea')}
                  </button>
                </p>
              )}
              {el.kind === 'wall' && el.aMm != null && el.bMm == null && (
                <p className="mt-1 text-xs text-amber">{t('projectImport.el.needHeight')}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** One coverage metric «площа 3/4» — green tick when full, amber dot when partial. */
function CoverageMetric({ label, have, total }: { label: string; have: number; total: number }) {
  const full = have >= total;
  return (
    <span className={cn('inline-flex items-center gap-1', full ? 'text-success' : 'text-amber')}>
      <span aria-hidden="true">{full ? '✓' : '•'}</span>
      {label} {have}/{total}
    </span>
  );
}

/** «файл.pdf · стор. 3» for page rows, the plain label otherwise. */
function rowLabel(d: { name: string; page?: number }): string {
  return d.page ? `${docLabel(d.name)} · стор. ${d.page}` : docLabel(d.name);
}

/** Floor labels for the review, from the CURRENT room state (floors are editable there). */
function reviewFloorLabels(rooms: { floor: string | null }[]): string[] {
  const labels: string[] = [];
  for (const r of rooms) {
    const l = r.floor ?? '';
    if (!labels.includes(l)) labels.push(l);
  }
  return labels;
}

/** Schema field names → what the master calls them, for the «перепровірити» line. */
function fieldLabel(field: string, t: (k: string) => string): string {
  const key = `projectImport.field.${field}`;
  const label = t(key);
  // i18next echoes the key back when it is missing: a field we have no word for is shown as-is
  // rather than as «projectImport.field.somethingNew».
  return label === key ? field : label;
}

/**
 * Why this page is worth a look, in the master's own terms — «89 розмірів · 11 площ · висоти».
 *
 * Shown on every row, ticked or not, because the alternative is a grey list of file names where the
 * only way to find the sheet with the dimensions on it is to open all 25 in another app.
 */
function evidenceNote(
  e: PageEvidence | undefined,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  if (!e) return '';
  if (e.raster) return t('projectImport.evidenceRaster');
  const parts: string[] = [];
  if (e.chains > 0) parts.push(t('projectImport.evidenceChains', { n: e.chains }));
  if (e.areas > 0) parts.push(t('projectImport.evidenceAreas', { n: e.areas }));
  if (e.heights) parts.push(t('projectImport.evidenceHeights'));
  if (e.openingSpec) parts.push(t('projectImport.evidenceOpenings'));
  return parts.join(' · ');
}

/** What the selected document kinds can produce — shown before parsing. */
function capabilityNote(selected: { kind: DocKind }[], t: (k: string) => string): string {
  const kinds = new Set(selected.map((d) => d.kind));
  if (kinds.has('PLAN_MEASURE')) return t('projectImport.canFull');
  if (kinds.has('ROOM_SCHEDULE')) return t('projectImport.canAreas');
  if (kinds.has('COVERINGS')) return t('projectImport.coveringsOnly');
  return t('projectImport.canAreas');
}

