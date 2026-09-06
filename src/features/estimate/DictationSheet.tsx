import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Select } from '@/components/Select.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { dictationApi } from '@/api/dictation.ts';
import { toast } from '@/hooks/useToast.ts';
import { useOnlineGuard } from '@/hooks/useOnlineGuard.ts';
import { toAppError } from '@/api/errors.ts';
import { parseDecimal } from '@/lib/decimal.ts';
import { cn } from '@/lib/cn.ts';
import { useSpeechDictation } from '@/hooks/useSpeechDictation.ts';
import { useCreateCatalogItem } from '@/features/catalog/useCatalog.ts';
import { useInvalidateEstimate } from './useEstimate.ts';
import { TradeBadge } from '@/components/TradeBadge.tsx';
import { useMe } from '@/features/auth/useMe.ts';
import { UNITS } from '@/api/types.ts';
import type { DictationItem, ItemType, Trade, Unit } from '@/api/types.ts';

/** Wording differs (case/whitespace/punctuation aside) — the two sentences worth teaching a synonym for. */
function wordingDiffers(spoken: string, matched: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return norm(spoken) !== '' && norm(spoken) !== norm(matched);
}

/**
 * Uppercase the first letter of a dictated name — the Web Speech API returns everything lowercase,
 * and the master's own price list uses «Штукатурити стіни…», not «штукатурити». Master feedback
 * 2026-09-04: «позиції надиктовані пишуться з малої букви, перша має бути велика». Only touches an
 * UNMATCHED row's name; a matched row already carries the catalog's own capitalisation.
 */
function capitalizeFirst(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toLocaleUpperCase('uk-UA') + trimmed.slice(1);
}

/** Parse a decimal field to a finite number, blank/garbage → 0 (master may fill later). */
function num(s: string): number {
  const n = parseDecimal(s);
  return Number.isFinite(n) ? n : 0;
}

interface Draft {
  key: number;
  /** The catalog's wording when matched, else what he said — editable either way. */
  name: string;
  /** What he actually said. Shown only when it differs from `name`, so a wrong match is visible. */
  spokenName: string;
  quantity: string;
  price: string;
  unit: Unit | '';
  type: ItemType;
  /** The matched catalog row's category — carried onto the estimate line, so the position lands
   *  in its category on the estimate board instead of «Без категорії» (master feedback 2026-09-04:
   *  «чому воно не підтягує трейд і категорію»). Same rule as name/unit/price: the parse read
   *  this, so the commit sends it. Editable in the drawer is out of scope for now. */
  category: string | null;
  /** The matched catalog row's trade — shown as a small badge on the review row. Null on an
   *  unmatched row; on save-to-catalog the master picks a trade explicitly (see `saveTrade`). */
  trade: Trade | null;
  /** Did his own price list have this position? A miss means the price is his to type. */
  matched: boolean;
  /** The matched catalog row's id — remembered so we can teach a synonym pointing at it after commit. */
  catalogItemId: string | null;
  /** Learn this position into his catalog too — offered only on a miss, and only once it has a price. */
  saveToCatalog: boolean;
  /** Under which system trade a save-to-catalog position should be filed (default: OTHER, keeps
   *  the existing «Інше» pile behaviour for a master who never touches the picker). Ignored when
   *  `saveCustomTradeId` is set. */
  saveTrade: Trade;
  /** Under which of the master's OWN custom trades (`user_trade`) the save-to-catalog position
   *  should be filed; overrides `saveTrade`. Null = a system trade is used. */
  saveCustomTradeId: string | null;
  /**
   * Teach the system to recognise the spoken wording as the matched row next time — offered only on
   * a matched row whose wording differs. See docs/open-questions.md → «A learned synonym outlives
   * the catalog position it points at».
   */
  saveSynonym: boolean;
  include: boolean;
}

type Step = 'input' | 'parsing' | 'review';

function toDrafts(items: DictationItem[]): Draft[] {
  return items.map((it, i) => ({
    key: i,
    // A matched row uses the catalog's own wording — leave it untouched. An unmatched row (the
    // server sends back what the master said, lowercase) gets its first letter capitalised so the
    // review reads like the estimate line the master will sign, not like a chat log.
    name: it.catalogItemId ? it.name : capitalizeFirst(it.name),
    spokenName: it.spokenName,
    quantity: it.quantity != null && it.quantity > 0 ? String(it.quantity) : '',
    price: it.unitPrice != null && it.unitPrice > 0 ? String(it.unitPrice) : '',
    unit: it.unit ?? '',
    type: it.type,
    category: it.category ?? null,
    trade: it.trade ?? null,
    matched: it.catalogItemId != null,
    catalogItemId: it.catalogItemId ?? null,
    saveToCatalog: false,
    // Default target trade when saving to catalog stays OTHER — same behaviour a master without
    // custom trades would get before this feature. Master's explicit picker overrides.
    saveTrade: 'OTHER',
    saveCustomTradeId: null,
    saveSynonym: false,
    include: true,
  }));
}

/**
 * Dictate (or type) positions into an open estimate.
 *
 * <p><b>Two microphones, and the in-app one is the optional half.</b> Cut 0 shipped the field plus
 * the microphone already on the master's PHONE keyboard — the OS transcribes Ukrainian on the
 * device, for free, and that path still works everywhere and is still the fallback. Cut 1 adds the
 * in-app button he asked for («натиснув надиктувати і воно відкрило мікрофон»), which is the Web
 * Speech API and therefore <b>not available everywhere</b> — most importantly not inside a PWA
 * installed on iOS, where it fails silently. `useSpeechDictation` answers that question; when the
 * answer is no, this screen is exactly what cut 0 shipped. See `lib/speech.ts`.</p>
 *
 * <p>Either way we record and store no audio. What we add is the part the OS cannot do — splitting
 * «поклеїти шпалери двадцять квадратів по 250» into a position, a number and a unit, and pinning it
 * to HIS price list.</p>
 *
 * <p><b>A miss is shown, never priced at 0 ₴ behind his back.</b> A row the catalog had no answer
 * for is flagged in the review with its price field empty — that is the whole reason this screen
 * exists instead of appending the lines straight away.</p>
 */
export function DictationSheet({
  open,
  onClose,
  estimateId,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  estimateId: string;
  /**
   * Ids of the just-appended estimate lines, so the parent can highlight them (green new / orange
   * touched, {@code EstimateEditorPage.markTouched}) and scroll the first one into view. Called
   * BEFORE `onClose`, so `lastTouched` lands while this sheet is still on screen; the actual scroll
   * happens after the modal-lock lifts, driven by `estimate.data` refetch after `invalidateEstimate`.
   */
  onAdded?: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const invalidateEstimate = useInvalidateEstimate(estimateId);
  const { online } = useOnlineGuard(); // the parse is a model call — no offline path
  const { data: me } = useMe(); // master's own trades + custom trades — feed the save-to-catalog picker
  const [step, setStep] = useState<Step>('input');
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [committing, setCommitting] = useState(false);
  const createCatalogItem = useCreateCatalogItem();

  // A spoken chunk goes in on its OWN LINE: the recogniser ends an utterance at a pause, which is
  // usually one position, and a line break is the split this flow already documents («одна позиція
  // на рядок»). It is appended, never written over — he can keep typing between two utterances.
  const appendSpoken = useCallback((chunk: string) => {
    setText((prev) => (prev.trim() ? prev.replace(/\s+$/, '') + '\n' + chunk : chunk));
  }, []);
  const mic = useSpeechDictation({ onFinal: appendSpoken });

  const reset = () => {
    mic.stop();
    setStep('input');
    setText('');
    setDrafts([]);
    setCommitting(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const patch = (key: number, p: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...p } : d)));

  const included = drafts.filter((d) => d.include);
  const unpriced = included.filter((d) => num(d.price) <= 0).length;
  // Empty / 0 / negative price blocks the commit end-to-end (master feedback 2026-09-04: «з пустою
  // ціною чи 0 чи мінусом числом не зберігаємо нічого»). All-or-nothing: one bad row disables the
  // whole «Додати», the top-of-review banner names how many, and the backend `@DecimalMin(inclusive
  // = false)` refuses it belt-and-braces if the button is ever bypassed.
  const hasBad = included.some((d) => !d.name.trim() || !d.unit || num(d.price) <= 0);

  const runParse = async () => {
    if (!online) {
      toast.error(t('offline.needConnection'));
      return;
    }
    mic.stop(); // a recogniser still listening while we read the text is a second source of truth
    setStep('parsing');
    try {
      const res = await dictationApi.parse(estimateId, text.trim());
      setDrafts(toDrafts(res.items));
      setStep('review');
    } catch (err) {
      toast.error(toAppError(err).message);
      setStep('input'); // his text is still in the field — a failed read must not cost him it
    }
  };

  const commit = async () => {
    setCommitting(true);
    try {
      const updated = await dictationApi.commit(
        estimateId,
        included.map((d) => ({
          name: d.name.trim(),
          unit: d.unit as Unit,
          quantity: num(d.quantity),
          unitPrice: num(d.price),
          type: d.type,
          // Carried from the matched catalog row; null on a genuinely new position. The estimate
          // line uses this to sort into its category on the board.
          category: d.category,
        })),
      );
      // Backend `appendItems` orders by ascending sortOrder and appends new rows at the tail —
      // so the last `included.length` items in the response are exactly the ones just added.
      // Tell the editor about them so it can green-highlight + scroll (see `markTouched`).
      const newIds = updated.items.slice(-included.length).map((r) => r.id);
      onAdded?.(newIds);
      invalidateEstimate();
      // Only AFTER the lines actually landed: the estimate is what he asked for, the catalog copy is
      // a bonus, and a failing copy must never look like the dictation failed.
      const learn = included.filter((d) => !d.matched && d.saveToCatalog && num(d.price) > 0);
      let saved = 0;
      let failed = false;
      for (const d of learn) {
        try {
          await createCatalogItem.mutateAsync({
            name: d.name.trim(),
            type: d.type,
            unit: d.unit as Unit,
            defaultPrice: num(d.price),
            // Master feedback 2026-09-04: «коли ми це додаємо в каталог ми маємо мати можливість
            // вказати трейд зі списка випадаючого». The picker below the tick sets `saveTrade`
            // (a system trade) OR `saveCustomTradeId` (one of his own custom trades). A custom
            // trade always rides under system trade OTHER (V91 invariant).
            trade: d.saveCustomTradeId ? 'OTHER' : d.saveTrade,
            customTradeId: d.saveCustomTradeId,
          });
          saved += 1;
        } catch {
          failed = true;
        }
      }
      // Same rule for synonyms: only after the lines landed, and a failure never rolls back the
      // commit. A synonym is only worth teaching when it points at a MATCHED row and the wording
      // differs — a matched row with identical wording teaches nothing new.
      const teach = included.filter(
        (d) => d.matched && d.saveSynonym && d.catalogItemId && wordingDiffers(d.spokenName, d.name),
      );
      let synonyms = 0;
      let synonymFailed = false;
      for (const d of teach) {
        try {
          await dictationApi.saveSynonym(d.catalogItemId as string, d.spokenName);
          synonyms += 1;
        } catch {
          synonymFailed = true;
        }
      }
      toast.success(
        saved > 0
          ? t('dictation.addedAndSaved', { count: included.length, saved })
          : t('dictation.added', { count: included.length }),
      );
      if (synonyms > 0) toast.success(t('dictation.learnedSynonyms', { count: synonyms }));
      if (failed) toast.error(t('dictation.catalogSaveFailed'));
      if (synonymFailed) toast.error(t('dictation.synonymSaveFailed'));
      close();
    } catch (err) {
      toast.error(toAppError(err).message);
      setCommitting(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title={t('dictation.title')} size="lg">
      {step === 'input' && (
        <div className="space-y-3">
          {/* Mic-first layout (2026-09-04): the big pulsing button leads the sheet — the OS
              keyboard's own microphone is not the only path any more, and the master's first tap
              should land on the one thing THIS sheet adds. The textarea sits under it, still
              full-size and full-width; the keyboard's own 🎤 is one of the ways to fill it, named
              in the hint but not surfaced as a competing button. Layout ordering: mic → hint →
              textarea → catalog hint → «Розпізнати». See docs/iteration-dictation.md §7.2. */}
          {mic.available && (
            <button
              type="button"
              onClick={() => (mic.listening ? mic.stop() : mic.start())}
              aria-pressed={mic.listening}
              aria-label={mic.listening ? t('dictation.micStop') : t('dictation.micStart')}
              className={cn(
                'relative flex w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 py-6 transition-colors',
                mic.listening
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-brand-300 bg-brand-50/40 text-brand-700 hover:bg-brand-50',
              )}
            >
              <span className="relative flex h-16 w-16 items-center justify-center">
                {mic.listening && (
                  // A soft ping BEHIND the icon — the confidence-inspiring visual borrowed from
                  // the marketplace patterns (Epicentr et al.). Never on the icon itself: an icon
                  // that pulses reads as broken, not listening.
                  <span
                    aria-hidden="true"
                    className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-60"
                  />
                )}
                <span className="relative text-4xl">{mic.listening ? '⏹' : '🎤'}</span>
              </span>
              <span className="text-base font-semibold">
                {mic.listening ? t('dictation.micStop') : t('dictation.micStart')}
              </span>
              {mic.listening && (
                // What is being heard — larger than in cut 1 (was `text-sm`), because it IS the
                // whole feedback the master gets that the mic is doing anything.
                <span aria-live="polite" className="mt-1 min-h-[1.5rem] text-base text-brand-700">
                  {mic.interim || t('dictation.listening')}
                </span>
              )}
            </button>
          )}
          {mic.blocked && (
            // The button is gone for this session; say why, and point at the one that still works.
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {mic.blocked === 'denied'
                ? t('dictation.micDenied')
                : mic.blocked === 'audio'
                  ? t('dictation.micNoDevice')
                  : mic.blocked === 'network'
                    ? t('dictation.micNoNetwork')
                    : t('dictation.micNoService')}
            </p>
          )}
          <p className="text-xs text-muted">
            {mic.available ? t('dictation.hintOrType') : t('dictation.hint')}
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={mic.available ? 5 : 7}
            aria-label={t('dictation.fieldLabel')}
            placeholder={t('dictation.placeholder')}
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-base text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          <p className="text-xs text-muted">{t('dictation.catalogHint')}</p>
          <Button fullWidth disabled={!text.trim() || !online} onClick={() => void runParse()}>
            {t('dictation.recognize')}
          </Button>
        </div>
      )}

      {step === 'parsing' && (
        <div className="py-10 text-center">
          <Spinner size="lg" />
          <p className="mt-3 text-sm text-muted">{t('dictation.parsing')}</p>
        </div>
      )}

      {step === 'review' && (
        <div>
          {drafts.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted">{t('dictation.nothingFound')}</p>
              <Button className="mt-4" variant="secondary" onClick={() => setStep('input')}>
                {t('dictation.backToText')}
              </Button>
            </div>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted">{t('dictation.reviewHint')}</p>
              {unpriced > 0 && (
                // Named before he taps «Додати»: an unpriced line BLOCKS the commit (master
                // feedback 2026-09-04) — the button is disabled below and the banner says why.
                <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {t('dictation.unpricedBlocking', { count: unpriced })}
                </p>
              )}
              <div className="max-h-[55dvh] space-y-2 overflow-y-auto">
                {drafts.map((d) => {
                  const bad = d.include && (!d.name.trim() || !d.unit);
                  const noPrice = d.include && num(d.price) <= 0;
                  return (
                    <div
                      key={d.key}
                      className={cn(
                        'rounded-xl border p-3',
                        !d.include
                          ? 'border-border bg-surface-sunken opacity-50'
                          : bad || noPrice
                            ? 'border-amber-400 bg-amber-50'
                            : 'border-border bg-surface',
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <Input
                          value={d.name}
                          onChange={(e) => patch(d.key, { name: e.target.value })}
                          className="flex-1"
                          placeholder={t('estimateImport.namePlaceholder')}
                        />
                        <button
                          type="button"
                          aria-label={t('estimateImport.removeRow')}
                          onClick={() => patch(d.key, { include: !d.include })}
                          className="mt-1 flex-shrink-0 text-lg text-muted"
                        >
                          {d.include ? '🗑' : '↩'}
                        </button>
                      </div>
                      {/* An unmatched row gets a distinct «Нова позиція» card with the save-to-catalog
                          offer front and centre — a plain inline checkbox was easy to miss (master
                          feedback 2026-09-04: «воно не питає чи додати в каталог, якщо такої
                          позиції нема взагалі»). The card also lets the amber «впишіть ціну» hint
                          collapse to a soft «нова позиція» line once the price is there («ціна ж є,
                          чому воно її тут згадує»). */}
                      {!d.matched && d.include && (
                        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2">
                          <p className="text-xs font-semibold text-amber-800">
                            {noPrice ? t('dictation.notInCatalog') : t('dictation.newPositionOk')}
                          </p>
                          {/* Offered on a miss only, and DEAD until the row has a price. A 0 ₴
                              catalog row is exactly what this screen's flagging rule exists to
                              prevent — saved here, the NEXT dictation would match it and price the
                              line at 0 silently, a week later, through the back door. */}
                          <label
                            className={cn(
                              'mt-2 flex items-start gap-2 text-sm',
                              noPrice ? 'text-muted' : 'text-secondary',
                            )}
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5 h-5 w-5 flex-shrink-0"
                              checked={d.saveToCatalog && !noPrice}
                              disabled={noPrice}
                              onChange={(e) => patch(d.key, { saveToCatalog: e.target.checked })}
                            />
                            <span>
                              {t('dictation.saveToCatalog')}
                              {noPrice && (
                                <span className="mt-0.5 block text-xs">{t('dictation.saveNeedsPrice')}</span>
                              )}
                            </span>
                          </label>
                          {/* Trade picker — visible only when the master ticked save-to-catalog AND
                              the row has a price. Offers his OWN system trades + his custom trades,
                              not the full 11 (same list `ProfileEditModal` presents). Value is a
                              serialised key so the same <select> can carry both kinds: a system
                              trade rides as its enum name, a custom trade as `custom:<id>`. */}
                          {d.saveToCatalog && !noPrice && (
                            <label className="mt-2 flex items-center gap-2 text-xs text-secondary">
                              <span className="min-w-0 flex-shrink-0">{t('dictation.saveTradeLabel')}</span>
                              <Select
                                value={d.saveCustomTradeId ? 'custom:' + d.saveCustomTradeId : d.saveTrade}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v.startsWith('custom:')) {
                                    patch(d.key, { saveCustomTradeId: v.slice('custom:'.length), saveTrade: 'OTHER' });
                                  } else {
                                    patch(d.key, { saveCustomTradeId: null, saveTrade: v as Trade });
                                  }
                                }}
                                className="min-w-0 flex-1"
                              >
                                {(me?.trades ?? []).map((tr) => (
                                  <option key={tr} value={tr}>{t('trades.' + tr)}</option>
                                ))}
                                {(me?.customTrades ?? []).map((ct) => (
                                  <option key={ct.id} value={'custom:' + ct.id}>{ct.name}</option>
                                ))}
                                {/* «Інше» always available as a fallback for a master who never
                                    picked a specific trade — matches the current default. */}
                                {!(me?.trades ?? []).includes('OTHER') && (
                                  <option value="OTHER">{t('trades.OTHER')}</option>
                                )}
                              </Select>
                            </label>
                          )}
                        </div>
                      )}
                      {d.matched && d.trade && (
                        // Master feedback 2026-09-04: «в каталозі він під трейдом сантехніка, чому
                        // тут не видно». Small badge on every matched row (regardless of wording
                        // match), so the master can spot a wrong-trade match at a glance.
                        <div className="mt-1"><TradeBadge trade={d.trade} /></div>
                      )}
                      {d.matched && wordingDiffers(d.spokenName, d.name) && (
                        <>
                          <p className="mt-1 text-xs text-muted">
                            {t('dictation.spokenAs', { text: d.spokenName })}
                          </p>
                          {d.include && d.catalogItemId && (
                            // Teach «say X, mean THIS row» — offered only on a matched-but-different
                            // row. On an identical wording there is nothing to learn; on an unmatched
                            // row a synonym would point at a row that does not yet exist (the master
                            // ticks «save to catalog» there instead, and next time the exact-name
                            // rung matches without needing a synonym).
                            <label className="mt-2 flex items-start gap-2 text-xs text-secondary">
                              <input
                                type="checkbox"
                                className="mt-0.5 h-4 w-4 flex-shrink-0"
                                checked={d.saveSynonym}
                                onChange={(e) => patch(d.key, { saveSynonym: e.target.checked })}
                              />
                              <span>{t('dictation.saveSynonym', { text: d.spokenName })}</span>
                            </label>
                          )}
                        </>
                      )}
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <Input
                          value={d.quantity}
                          inputMode="decimal"
                          onChange={(e) => patch(d.key, { quantity: e.target.value })}
                          placeholder={t('estimateImport.qtyPlaceholder')}
                        />
                        <Select
                          value={d.unit}
                          onChange={(e) => patch(d.key, { unit: e.target.value as Unit | '' })}
                        >
                          <option value="">{t('import.pickUnit')}</option>
                          {UNITS.map((u) => (
                            <option key={u} value={u}>
                              {t('units.' + u)}
                            </option>
                          ))}
                        </Select>
                        <Input
                          value={d.price}
                          inputMode="decimal"
                          onChange={(e) => patch(d.key, { price: e.target.value })}
                          placeholder="₴"
                        />
                        <button
                          type="button"
                          onClick={() => patch(d.key, { type: d.type === 'WORK' ? 'MATERIAL' : 'WORK' })}
                          className="w-full rounded-lg border border-border px-3 py-2.5 text-sm font-semibold text-primary"
                        >
                          {t('itemType.' + d.type)}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <Button
                fullWidth
                className="mt-4"
                disabled={included.length === 0 || hasBad}
                loading={committing}
                onClick={() => void commit()}
              >
                {t('dictation.addN', { count: included.length })}
              </Button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
