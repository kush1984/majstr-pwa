import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { cn } from '@/lib/cn.ts';
import { CHASE_KINDS } from '@/components/WallDiagram.tsx';
import { electricalPlanApi } from '@/api/electricalPlan.ts';
import { pdfPageCount, parsePageRange, extractPdfPages } from '@/lib/pdfPages.ts';
import type { Confidence, ShtrobaPayload } from '@/api/types.ts';

const MAX_BYTES = 10 * 1024 * 1024;
const int = (s: string): number => Math.max(0, Math.round(Number(String(s).replace(',', '.')) || 0));

interface PointRow {
  key: number;
  type: string;
  count: string;
  heights: number[];
  confidence: Confidence;
  note: string | null;
}

type Step = 'source' | 'pages' | 'parsing' | 'review';

/** Legend wording → chase kind, for seeding the calculator drops. Heuristic; the master fixes it. */
function chaseKind(type: string): string {
  const s = type.toLowerCase();
  if (s.includes('розетк')) return 'socket';
  if (s.includes('вимикач')) return 'switch';
  if (s.includes('світильник') || s.includes('бра') || s.includes('люстр') || s.includes('освітл') || s.includes('лед')) return 'light';
  if (s.includes('кондиц') || s.includes('вивід') || s.includes('витяж')) return 'outlet';
  return 'socket';
}

/**
 * Count electrical points off a plan (PDF/photo) with Claude vision — a FLAT list (variant 2).
 *
 * The model reads what the designer PRINTED — the legend symbols and the «h=» heights — but
 * never MEASURES geometry off pixels, and never groups rooms or reads room sizes (that guess
 * was the source of the wrong «магістраль 1385» number). The reviewed points feed straight
 * into the chase/cable CALCULATOR (via {@link onApply}): each point becomes a drop the master
 * then distributes and prices, where every length is computed deterministically. The counts
 * (шт) are also saved as an ELECTRICAL_POINTS element for the estimate.
 *
 * Multi-sheet PDFs: the master picks the page(s) first (pdf-lib extracts them client-side) so
 * the model never counts across the wrong sheet.
 */
export function ElectricalPlanSheet({
  open,
  onClose,
  objectId,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  objectId: string;
  /** Hand the reviewed points to the section: save the counts, then open the seeded calculator. */
  onApply: (result: {
    points: { type: string; count: number; heights: number[] }[];
    seed: ShtrobaPayload;
  }) => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('source');
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageInput, setPageInput] = useState('');
  const [points, setPoints] = useState<PointRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [led, setLed] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const reset = () => {
    setStep('source');
    setFile(null);
    setPageCount(0);
    setPageInput('');
    setPoints([]);
    setWarnings([]);
    setLed(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  const isPdf = (f: File): boolean => f.type.includes('pdf') || f.name.toLowerCase().endsWith('.pdf');

  const onPick = async (picked: File | undefined) => {
    if (!picked) return;
    if (picked.size > MAX_BYTES) {
      toast.error(t('photos.tooLarge'));
      return;
    }
    setFile(picked);
    if (isPdf(picked)) {
      const n = await pdfPageCount(picked);
      if (n > 1) {
        setPageCount(n);
        setPageInput('');
        setStep('pages');
        return;
      }
    }
    void parseFile(picked);
  };

  const onParsePages = async () => {
    if (!file) return;
    const pages = parsePageRange(pageInput, pageCount);
    if (pages.length === 0) {
      toast.error(t('electrical.pageEmpty'));
      return;
    }
    setStep('parsing');
    try {
      const trimmed = await extractPdfPages(file, pages);
      await parseFile(trimmed);
    } catch (err) {
      toast.error(toAppError(err).message);
      setStep('pages');
    }
  };

  const parseFile = async (f: File) => {
    setStep('parsing');
    try {
      const res = await electricalPlanApi.parse(objectId, f);
      setPoints(res.points.map((p) => ({
        key: seq.current++,
        type: p.type,
        count: String(p.count),
        heights: p.heights,
        confidence: p.confidence,
        note: p.note,
      })));
      setWarnings(res.warnings);
      setLed(res.ledStripPresent);
      setStep('review');
    } catch (err) {
      toast.error(toAppError(err).message);
      reset();
    }
  };

  const validPoints = points.filter((p) => p.type.trim() && int(p.count) > 0);
  const totalPoints = validPoints.reduce((a, p) => a + int(p.count), 0);

  const setPoint = (key: number, patch: Partial<PointRow>) =>
    setPoints((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const apply = () => {
    const countPoints = validPoints.map((p) => ({ type: p.type.trim(), count: int(p.count), heights: p.heights }));
    // Each recognised point → one drop (kind mapped from the legend, its read height, its count).
    // The master sets the bus length and per-drop «штробити» in the calculator.
    const seedDrops = validPoints.map((p) => {
      const kind = chaseKind(p.type);
      return { kind, h: p.heights[0] ?? CHASE_KINDS[kind].defH, qty: int(p.count), chase: true };
    });
    const seed: ShtrobaPayload = {
      busLevel: 2600, busFromTop: true, busLength: 0, busChase: true, reservePct: 10, points: seedDrops,
    };
    onApply({ points: countPoints, seed });
    close();
  };

  return (
    <Modal open={open} onClose={close} title={t('electrical.title')} size="lg">
      {step === 'source' && (
        <div className="space-y-3">
          <p className="text-sm text-muted">{t('electrical.sourceHint')}</p>
          <Button fullWidth onClick={() => pickRef.current?.click()}>{t('electrical.pick')}</Button>
          <input ref={pickRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      )}

      {step === 'pages' && (
        <div className="space-y-3">
          <p className="text-sm text-muted">{t('electrical.pdfPages', { count: pageCount })}</p>
          <Input inputMode="numeric" autoFocus value={pageInput} placeholder={t('electrical.pagePlaceholder')}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void onParsePages(); }} />
          <Button fullWidth disabled={parsePageRange(pageInput, pageCount).length === 0} onClick={() => void onParsePages()}>
            {t('electrical.pageParse')}
          </Button>
        </div>
      )}

      {step === 'parsing' && (
        <div className="py-10 text-center">
          <Spinner size="lg" />
          <p className="mt-3 text-sm text-muted">{t('electrical.parsing')}</p>
        </div>
      )}

      {step === 'review' && (
        validPoints.length === 0 && points.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted">{t('electrical.nothing')}</p>
            <Button className="mt-4" variant="secondary" onClick={reset}>{t('sketch.tryAgain')}</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted">{t('electrical.reviewHint')}</p>

            {warnings.length > 0 && (
              <div className="rounded-xl bg-amber-soft p-3 text-xs text-amber">
                <ul className="list-disc space-y-0.5 pl-4">
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
            {led && <div className="rounded-xl bg-amber-soft p-3 text-xs text-amber">{t('electrical.ledHint')}</div>}

            <div className="space-y-2">
              {points.map((p) => {
                const flagged = p.confidence !== 'high';
                return (
                  <div key={p.key}
                    className={cn('rounded-lg border p-2', flagged ? 'border-amber-400 bg-amber-soft' : 'border-border bg-surface-sunken')}>
                    <div className="flex items-center gap-2">
                      <Input value={p.type} className="flex-1"
                        onChange={(e) => setPoint(p.key, { type: e.target.value })} />
                      <Input inputMode="numeric" value={p.count} className="w-16"
                        onChange={(e) => setPoint(p.key, { count: e.target.value })} />
                      <button type="button" aria-label={t('common.delete')} className="px-1 text-muted"
                        onClick={() => setPoints((ps) => ps.filter((x) => x.key !== p.key))}>🗑</button>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                      {p.heights.length > 0 && <span>h={p.heights.join(', ')} мм</span>}
                      {flagged && <span className="text-amber">· {t('electrical.check')}{p.note ? ` — ${p.note}` : ''}</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            <button type="button" className="text-xs font-semibold text-brand"
              onClick={() => setPoints((ps) => [...ps, { key: seq.current++, type: '', count: '', heights: [], confidence: 'high', note: null }])}>
              {t('measure.addPointType')}
            </button>

            <p className="border-t border-border pt-3 text-xs text-muted">{t('electrical.applyHint')}</p>
            <Button fullWidth disabled={validPoints.length === 0} onClick={apply}>
              {t('electrical.apply', { points: totalPoints })}
            </Button>
          </div>
        )
      )}
    </Modal>
  );
}
