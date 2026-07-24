import { useMemo, useRef, useState } from 'react';
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
  docLabel,
  extract7z,
  extractZipEntries,
  isDocEntry,
  listZipEntries,
  MAX_ENTRY_BYTES,
  pdfPageTexts,
  type ClassifiedDoc,
  type DocKind,
} from '@/lib/projectDocs.ts';
import { extractPdfPages, pdfPageCount } from '@/lib/pdfPages.ts';
import { projectImportApi } from '@/api/projectImport.ts';
import { MEASUREMENTS_KEY } from './useMeasurements.ts';
import {
  crossCheck,
  deriveFromInputs,
  ELEMENT_NAMES,
  mergeParses,
  perimeterFrom,
  roomItems,
  wallBreakdown,
  type ElementKind,
  type MergedImport,
  type RoomInputs,
} from './projectImportMerge.ts';
import type {
  ProjectImportCommitRoom,
  ProjectImportOpening,
  ProjectImportParseResponse,
} from '@/api/types.ts';

type Step = 'source' | 'files' | 'parsing' | 'heights' | 'review';

interface DocRow extends ClassifiedDoc {
  id: number;
  /** Where the bytes come from: a picked file, an entry of a zip/7z, or ONE page of a PDF. */
  file?: File;
  zipName?: string;
  sevenZip?: boolean;
  /** 1-based page of a multi-page PDF — split out client-side before upload. */
  page?: number;
}

interface ElementRow {
  kind: ElementKind;
  value: number;
  enabled: boolean;
}

/** Where a number on the card came from — shown small under each field. */
type FieldSource = 'doc' | 'calc' | 'manual';

interface RoomRow {
  key: string;
  name: string;
  floor: string | null;
  areaM2: number | null;
  confidence: string;
  notes: string[];
  elements: ElementRow[];
  missing: { kind: ElementKind; reason: string }[];
  /** Live inputs — every field is ALWAYS present, empty when nothing was recognised. */
  inputs: RoomInputs;
  sources: Partial<Record<'width' | 'length' | 'height' | 'perimeter', FieldSource>>;
  /** Gabarits the model read but the checksum rejected — a greyed hint, never computed with. */
  rejected: { widthMm: number; lengthMm: number } | null;
  /** Confirmed L-shape (the checksum proved A×B−a×b) — the floor keeps its real shape. */
  cut: { widthMm: number; depthMm: number } | null;
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
}: {
  open: boolean;
  onClose: () => void;
  objectId: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('source');
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [progress, setProgress] = useState('');
  const [merged, setMerged] = useState<MergedImport | null>(null);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [heights, setHeights] = useState<Record<string, string>>({});
  const [reserve, setReserve] = useState('0');
  const [saving, setSaving] = useState(false);
  /** What the auto-pick actually parsed — shown on the review so it's never a black box. */
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
    setReserve('0');
    setSaving(false);
    setMakeCeilings(false);
    setMovingRooms(new Set());
    setMoveTarget('');
    setUsedRows([]);
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
    if (pages <= 1) {
      return [{ id: seq.current++, ...classifyDoc(file.name), file }];
    }
    const nameFloor = classifyDoc(file.name).floor;
    let texts: string[] = [];
    try {
      texts = await pdfPageTexts(await file.arrayBuffer());
    } catch {
      texts = new Array<string>(pages).fill('');
    }
    return texts.map((text, i) => {
      const cls = text.trim() ? classifyPageText(text) : { kind: 'OTHER' as DocKind, floor: null };
      return {
        id: seq.current++,
        name: file.name,
        kind: cls.kind,
        floor: cls.floor ?? nameFloor,
        // COVERINGS is never ticked — it yields no per-room measurements (shown as skipped).
        useful: cls.kind === 'ROOM_SCHEDULE' || cls.kind === 'PLAN_MEASURE',
        file,
        page: i + 1,
      };
    });
  };

  const onPick = async (files: FileList | null) => {
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
          rows.push({ id: seq.current++, ...classifyDoc(file.name), file });
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
    setDocs(rows);
    // The master shouldn't have to hunt for the measure sheet in a 25-page set: when the
    // classifier found the useful page(s) unambiguously, parse them straight away. The
    // file list is the FALLBACK (nothing found, or too many) — and the review screen keeps
    // a «взяти інші сторінки» way back.
    // One sheet per KIND+FLOOR: a real set often carries near-identical variants
    // («1_обмірний план 1п» and «7_обмірний план 1п») — parsing both costs two LLM
    // calls for the same rooms. The rest stay in the list, unticked, for the master.
    const seen = new Set<string>();
    const auto = rows.filter((r) => {
      if (!r.useful) return false;
      const slot = `${r.kind}|${r.floor ?? ''}`;
      if (seen.has(slot)) {
        r.useful = false;
        return false;
      }
      seen.add(slot);
      return true;
    });
    if (auto.length > 0 && auto.length <= MAX_SELECTED) {
      setStep('parsing');
      void runParse(auto);
      return;
    }
    setStep('files');
  };

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
    setRooms(m.rooms.map((room) => {
      const heightMm = room.ceilingHmm ?? heightMmOf(h, room.floor);
      const inputs: RoomInputs = {
        areaM2: room.areaM2,
        widthMm: room.widthMm,
        lengthMm: room.lengthMm,
        perimeterMm: room.perimeterMm,
        heightMm,
        openings: room.openings,
      };
      const { elements, missing } = deriveFromInputs(inputs);
      return {
        key: room.key,
        name: room.name,
        floor: room.floor,
        areaM2: room.areaM2,
        confidence: room.confidence,
        notes: room.notes,
        // Ceiling starts OFF: for a rectangular room it's a duplicate of the floor
        // that doubles every total — the review checkbox enables it (mansards etc.).
        elements: elements.map((e) => ({ kind: e.kind, value: e.value, enabled: e.kind !== 'ceiling' })),
        missing,
        inputs,
        sources: {
          width: room.widthMm != null ? 'doc' : undefined,
          length: room.lengthMm != null ? 'doc' : undefined,
          height: room.ceilingHmm != null ? 'doc' : heightMm != null ? 'manual' : undefined,
          perimeter: room.perimeterMm != null ? (room.widthMm != null ? 'calc' : 'doc') : undefined,
        },
        rejected: room.rejected,
        cut: room.cutWidthMm != null && room.cutDepthMm != null
          ? { widthMm: room.cutWidthMm, depthMm: room.cutDepthMm }
          : null,
      };
    }));
    setStep('review');
  };

  /**
   * A field on the card changed → recompute the whole package right away. This is the
   * cascade: width alone gives length (area ÷ width) → perimeter → and with a height,
   * walls appear instead of a dead-end "введіть вручну".
   */
  const patchInputs = (roomKey: string, patch: Partial<RoomInputs>, source: FieldSource = 'manual') =>
    setRooms((prev) => prev.map((r) => {
      if (r.key !== roomKey) return r;
      const inputs: RoomInputs = { ...r.inputs, ...patch };
      // A typed width invalidates a stale recognised length — recompute it from the area.
      if (patch.widthMm !== undefined && patch.lengthMm === undefined && inputs.areaM2 != null) {
        inputs.lengthMm = inputs.widthMm ? (inputs.areaM2 * 1_000_000) / inputs.widthMm : null;
      }
      inputs.perimeterMm = perimeterFrom(inputs);
      const { elements, missing } = deriveFromInputs(inputs);
      const enabledOf = (kind: ElementKind) =>
        r.elements.find((e) => e.kind === kind)?.enabled ?? (kind === 'ceiling' ? makeCeilings : true);
      const sources = { ...r.sources };
      if (patch.widthMm !== undefined) {
        sources.width = source;
        sources.length = 'calc';
        sources.perimeter = 'calc';
      }
      if (patch.lengthMm !== undefined) {
        sources.length = source;
        sources.perimeter = 'calc';
      }
      if (patch.heightMm !== undefined) sources.height = source;
      if (patch.perimeterMm !== undefined) sources.perimeter = source;
      return {
        ...r,
        inputs,
        sources,
        elements: elements.map((e) => ({ kind: e.kind, value: e.value, enabled: enabledOf(e.kind) })),
        missing,
      };
    }));

  const toggleCeilings = (on: boolean) => {
    setMakeCeilings(on);
    setRooms((prev) => prev.map((r) => ({
      ...r,
      elements: r.elements.map((e) => (e.kind === 'ceiling' ? { ...e, enabled: on } : e)),
    })));
  };

  /** What the import could NOT produce, aggregated — never a silent "nothing happened". */
  const gaps = useMemo(() => {
    const noHeightFloors: string[] = [];
    let noPerimeter = 0;
    for (const r of rooms) {
      for (const m of r.missing) {
        if (m.kind === 'walls' && m.reason === 'no-height') {
          const label = r.floor ?? '';
          if (!noHeightFloors.includes(label)) noHeightFloors.push(label);
        }
        if (m.kind === 'walls' && m.reason === 'no-perimeter') noPerimeter++;
      }
    }
    return { noHeightFloors, noPerimeter };
  }, [rooms]);

  // ---- step 5: review + commit ------------------------------------------------

  const setElement = (roomKey: string, kind: ElementKind, patch: Partial<ElementRow>) =>
    setRooms((prev) => prev.map((r) => r.key !== roomKey ? r : {
      ...r,
      elements: r.elements.map((e) => (e.kind === kind ? { ...e, ...patch } : e)),
    }));

  const removeRoom = (key: string) => setRooms((prev) => prev.filter((r) => r.key !== key));

  const reservePct = Math.max(0, Number(reserve.replace(',', '.')) || 0);
  const commitRooms: ProjectImportCommitRoom[] = useMemo(() => {
    const out: ProjectImportCommitRoom[] = [];
    for (const r of rooms) {
      const items = roomItems(r.elements, reservePct);
      if (items.length > 0) {
        out.push({ name: r.name, floor: r.floor, items });
      }
    }
    // A coverings spec deliberately creates NO measurements: its figures are material
    // totals for the whole object, not per-room geometry. It's reported as skipped.
    return out;
  }, [rooms, reservePct]);

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
                    <span className="block truncate text-sm text-primary">{rowLabel(d)}</span>
                    <span className="block text-[11px] text-muted">
                      {kindLabel(d.kind)}
                      {d.floor && ` · ${t('projectImport.floorLabel', { floor: d.floor })}`}
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

          <Button fullWidth
            disabled={selected.length === 0 || selected.length > MAX_SELECTED
              || selected.some((d) => !IMPORT_KINDS.includes(d.kind))}
            onClick={() => void runParse()}>
            {t('projectImport.recognise', { n: selected.length })}
          </Button>
          {selected.length > MAX_SELECTED && (
            <p className="text-center text-xs text-amber">{t('projectImport.tooManySelected', { max: MAX_SELECTED })}</p>
          )}
          {selected.some((d) => !IMPORT_KINDS.includes(d.kind)) && (
            <p className="text-center text-xs text-muted">{t('projectImport.untickNoise')}</p>
          )}
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
            {(merged.warnings.length > 0 || areaSumOver != null
              || gaps.noHeightFloors.length > 0 || gaps.noPerimeter > 0) && (
              <div className="rounded-xl bg-amber-soft p-3 text-xs text-amber">
                <ul className="list-disc space-y-0.5 pl-4">
                  {areaSumOver != null && (
                    <li className="font-semibold">
                      {t('projectImport.crossCheck', { sum: areaSumOver, total: merged.totalAreaM2 })}
                    </li>
                  )}
                  {/* What the import could NOT compute — an explicit report, never silence. */}
                  {gaps.noHeightFloors.map((label) => (
                    <li key={`h-${label}`} className="font-semibold">
                      {t('projectImport.wallsNoHeight', {
                        floor: label || t('projectImport.noFloor'),
                      })}
                    </li>
                  ))}
                  {gaps.noPerimeter > 0 && (
                    <li className="font-semibold">{t('projectImport.wallsNoPerimeter', { n: gaps.noPerimeter })}</li>
                  )}
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
                        {room.areaM2 != null && (
                          <p className="mt-1 pl-6 text-xs text-muted">
                            {room.areaM2.toLocaleString('uk-UA')} {t('units.M2')}
                            {room.cut && ` · ${t('projectImport.lshapeDetected')}`}
                          </p>
                        )}

                        {/* Always-visible inputs: recognised ones are filled in, the rest
                            are EMPTY invitations to type — never a hidden dead end. */}
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <MmField label={t('projectImport.widthField')} value={room.inputs.widthMm}
                            source={room.sources.width} t={t}
                            onChange={(mm) => patchInputs(room.key, { widthMm: mm })} />
                          <MmField label={t('projectImport.lengthField')} value={room.inputs.lengthMm}
                            source={room.sources.length} t={t}
                            onChange={(mm) => patchInputs(room.key, { lengthMm: mm })} />
                          <MmField label={t('projectImport.heightField')} value={room.inputs.heightMm}
                            source={room.sources.height} t={t}
                            onChange={(mm) => patchInputs(room.key, { heightMm: mm })} />
                          <MmField label={t('projectImport.perimeterField')} value={room.inputs.perimeterMm}
                            source={room.sources.perimeter} t={t}
                            onChange={(mm) => patchInputs(room.key, { perimeterMm: mm })} />
                        </div>
                        {room.rejected && (
                          <p className="mt-1 text-xs text-muted">
                            {t('projectImport.rejectedHint', {
                              w: (room.rejected.widthMm / 1000).toLocaleString('uk-UA'),
                              l: (room.rejected.lengthMm / 1000).toLocaleString('uk-UA'),
                            })}
                            {' '}
                            <button type="button" className="font-semibold text-brand"
                              onClick={() => patchInputs(room.key, {
                                widthMm: room.rejected!.widthMm, lengthMm: room.rejected!.lengthMm,
                              }, 'doc')}>
                              {t('projectImport.rejectedTake')}
                            </button>
                          </p>
                        )}

                        {/* Openings drive netto walls + reveals; editable, or added by hand. */}
                        <OpeningsBlock room={room} t={t}
                          onChange={(openings) => patchInputs(room.key, { openings })} />

                        {(() => {
                          const w = wallBreakdown(room.inputs);
                          if (!w) return null;
                          return (
                            <p className="mt-1.5 text-xs text-muted">
                              {t('projectImport.wallsBreakdown', {
                                gross: w.grossM2.toLocaleString('uk-UA'),
                                openings: w.openingsM2.toLocaleString('uk-UA'),
                                net: w.netM2.toLocaleString('uk-UA'),
                              })}
                              {w.openingsUnknown && ` · ${t('projectImport.openingsUnknown')}`}
                            </p>
                          );
                        })()}

                        <div className="mt-2 space-y-1">
                          {room.elements.map((e) => (
                            <label key={e.kind} className="flex items-center gap-2">
                              <input type="checkbox" checked={e.enabled}
                                onChange={() => setElement(room.key, e.kind, { enabled: !e.enabled })}
                                className="h-4 w-4 rounded border-border text-brand focus:ring-brand-200" />
                              <span className="w-20 text-sm text-primary">{ELEMENT_NAMES[e.kind]}</span>
                              <input inputMode="decimal" value={String(e.value)}
                                onChange={(ev) => setElement(room.key, e.kind, { value: Number(ev.target.value.replace(',', '.')) || 0 })}
                                className="w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-primary" />
                              <span className="text-xs text-muted">
                                {t(e.kind === 'plinth' || e.kind === 'reveals' ? 'units.LINEAR_METER' : 'units.M2')}
                              </span>
                            </label>
                          ))}
                          {room.missing.map((mi) => (
                            <p key={mi.kind} className="pl-6 text-xs text-muted">
                              {ELEMENT_NAMES[mi.kind]} — {t(`projectImport.missing.${mi.reason}`)}
                            </p>
                          ))}
                        </div>

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

            <div className="flex items-center gap-2 border-t border-border pt-3">
              <span className="text-sm text-primary">{t('projectImport.reserve')}</span>
              <input inputMode="numeric" value={reserve}
                onChange={(e) => setReserve(e.target.value)}
                className="w-16 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-primary" />
              <span className="text-sm text-muted">%</span>
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

/** One always-present dimension field in METRES (stored mm), with its source badge. */
function MmField({
  label, value, source, t, onChange,
}: {
  label: string;
  value: number | null;
  source?: FieldSource;
  t: (k: string) => string;
  onChange: (mm: number | null) => void;
}) {
  const shown = value == null ? '' : String(Math.round(value) / 1000);
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] text-muted">{label}</span>
      <input inputMode="decimal" value={shown}
        onChange={(e) => {
          const raw = e.target.value.replace(',', '.').trim();
          const v = Number(raw);
          onChange(raw && Number.isFinite(v) && v > 0 ? Math.round(v * 1000) : null);
        }}
        className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-primary" />
      <span className="mt-0.5 block text-[10px] text-faint">
        {value == null ? t('projectImport.src.empty') : t(`projectImport.src.${source ?? 'manual'}`)}
      </span>
    </label>
  );
}

/** The room's openings: recognised or hand-added; every edit recomputes walls + reveals. */
function OpeningsBlock({
  room, t, onChange,
}: {
  room: RoomRow;
  t: (k: string, o?: Record<string, unknown>) => string;
  onChange: (openings: ProjectImportOpening[]) => void;
}) {
  const list = room.inputs.openings;
  const patch = (i: number, p: Partial<ProjectImportOpening>) =>
    onChange(list.map((o, j) => (j === i ? { ...o, ...p } : o)));
  const num = (v: string) => {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : 0;
  };
  return (
    <div className="mt-2">
      <div className="mb-1 text-[11px] font-semibold text-muted">{t('projectImport.openingsTitle')}</div>
      <div className="space-y-1">
        {list.map((o, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <select value={o.kind} aria-label={t('projectImport.openingKind')}
              onChange={(e) => patch(i, { kind: e.target.value })}
              className="rounded-lg border border-border bg-surface px-1.5 py-1.5 text-xs text-primary">
              <option value="вікно">{t('projectImport.window')}</option>
              <option value="двері">{t('projectImport.door')}</option>
            </select>
            <input inputMode="decimal" value={String(o.wMm / 1000)} aria-label={t('projectImport.openingW')}
              onChange={(e) => patch(i, { wMm: num(e.target.value) })}
              className="w-14 rounded-lg border border-border bg-surface px-1.5 py-1.5 text-xs text-primary" />
            <span className="text-xs text-faint">×</span>
            <input inputMode="decimal" value={String(o.hMm / 1000)} aria-label={t('projectImport.openingH')}
              onChange={(e) => patch(i, { hMm: num(e.target.value) })}
              className="w-14 rounded-lg border border-border bg-surface px-1.5 py-1.5 text-xs text-primary" />
            <span className="text-xs text-faint">{t('units.M')}</span>
            <button type="button" aria-label={t('common.delete')} className="ml-auto px-1 text-muted"
              onClick={() => onChange(list.filter((_, j) => j !== i))}>🗑</button>
          </div>
        ))}
      </div>
      <button type="button" className="mt-1 text-xs font-semibold text-brand"
        onClick={() => onChange([...list, { kind: 'вікно', wMm: 1400, hMm: 1500, sillMm: 900, note: null }])}>
        {t('projectImport.addOpening')}
      </button>
    </div>
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

/** What the selected document kinds can produce — shown before parsing. */
function capabilityNote(selected: { kind: DocKind }[], t: (k: string) => string): string {
  const kinds = new Set(selected.map((d) => d.kind));
  if (kinds.has('PLAN_MEASURE')) return t('projectImport.canFull');
  if (kinds.has('ROOM_SCHEDULE')) return t('projectImport.canAreas');
  if (kinds.has('COVERINGS')) return t('projectImport.coveringsOnly');
  return t('projectImport.canAreas');
}

