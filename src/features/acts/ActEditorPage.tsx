import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Select } from '@/components/Select.tsx';
import { Checkbox } from '@/components/Checkbox.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { Modal } from '@/components/Modal.tsx';
import { InfoPopover } from '@/components/InfoPopover.tsx';
import { Fab, FabAction } from '@/components/Fab.tsx';
import { Section } from '@/components/Section.tsx';
import { Badge } from '@/components/Badge.tsx';
import { toast } from '@/hooks/useToast.ts';
import { useLeaveGuard } from '@/hooks/useLeaveGuard.ts';
import { toAppError } from '@/api/errors.ts';
import { track } from '@/lib/posthog.ts';
import { actsApi } from '@/api/acts.ts';
import { openPdfTab } from '@/lib/openPdfTab.ts';
import { formatMoney, formatMoneyExact, formatAmount } from '@/lib/format.ts';
import { parseMoney, parseQuantity, roundMoney, sumMoney } from '@/lib/decimal.ts';
import { estimateName } from '@/features/estimate/estimateName.ts';
import { CatalogAutocomplete } from '@/features/estimate/CatalogAutocomplete.tsx';
import { CatalogPicker } from '@/features/catalog/CatalogPicker.tsx';
import { routes } from '@/lib/config.ts';
import { newUuid } from '@/lib/uuid.ts';
import {
  useAct, useActProgress, useCreateAct, useUpdateActHeader, useReplaceActItems, useSignActOffline,
  useDeleteAct, useActsInvalidator,
} from './useActs.ts';
import { isoDay } from './useNewAct.ts';
import { useEconomy } from '@/features/economy/useEconomy.ts';
import { ActReceiptsSection, billedOf } from './ActReceiptsSection.tsx';
import { mergeQueuedReceipts, usePendingActReceipts } from './offlineReceipts.ts';
import { ActShareSheet } from './ActShareSheet.tsx';
import { ACT_UNITS } from '@/api/types.ts';
import { ACT_STATUS_VARIANT } from '@/lib/labels.ts';
import type {
  ActProgressLine, ItemType, Unit, WorkActItemLine, WorkActItemResponse, WorkActKind,
} from '@/api/types.ts';

const ADDITIONAL_WARNED_KEY = 'majstr-acts-additional-warned';

/** Group key for act lines whose estimate can no longer be named (the FK is ON DELETE SET NULL). */
const ACT_OWN_LINES = 'act';

/**
 * Review P-35. An unreadable field is NOT zero. «1 200», «12а» and «-5» all used to come out as
 * 0 ₴ in silence — an additional-work price signed as a free line, a credited advance that
 * vanished, a quantity that took its whole position out of the act. These answer `null`, the row
 * says so, and Save/«Підписати» stay shut until it reads. Blank stays 0: «nothing here» is an
 * answer a master gives on purpose, not a typo.
 */
const qtyOf = (s: string): number | null =>
  s.trim() === '' ? 0 : parseQuantity(s, { allowZero: true });
const moneyOf = (s: string): number | null =>
  s.trim() === '' ? 0 : parseMoney(s, { allowZero: true });
/** What to SHOW while a field is still wrong — the control it sits on is flagged red meanwhile. */
const num = (s: string): number => qtyOf(s) ?? 0;
const money = (s: string): number => moneyOf(s) ?? 0;

interface Additional { name: string; type: ItemType; unit: Unit; unitPrice: string; quantity: string; }

/** Lines of one estimate, sub-grouped by category in encounter order — the same estimate→category
 *  shape the act PDF prints, so the editor and the document read alike. */
function categorize(lines: ActProgressLine[]): [string, ActProgressLine[]][] {
  const map = new Map<string, ActProgressLine[]>();
  for (const line of lines) {
    const c = (line.category ?? '').trim();
    const list = map.get(c) ?? [];
    list.push(line);
    map.set(c, list);
  }
  return [...map.entries()];
}

/** Everything the editor can change, serialized — the dirty check is «snapshot now ≠ snapshot at
 *  seed/last save». One function for both sides so the serialization can never drift apart. */
function formSnapshot(s: {
  kind: WorkActKind; title: string; issuedAt: string; periodFrom: string; periodTo: string;
  contractRef: string; advance: string; showMaterials: boolean; showCumulative: boolean;
  receiptsToExpenses: boolean; showReceiptPhotos: boolean;
  qty: Record<string, string>; additional: Additional[];
}): string {
  return JSON.stringify(s);
}

/** The MONEY half of that form — the only part the totals are computed from. Kept apart because a
 *  retitled act is not a re-priced one: the auto-title alone makes every untitled draft read as
 *  drifted, and the server's own figures would then never be the ones shown. */
function moneySnapshot(s: {
  advance: string; showMaterials: boolean;
  qty: Record<string, string>; additional: Additional[];
}): string {
  return JSON.stringify(s);
}

/** Create/edit screen for one work act (acts iteration). Loads the act + the object's progress
 *  (each SIGNED-estimate line with done-so-far/remaining), lets the master tick lines (a tick fills
 *  the whole remainder) and add off-estimate works, then saves quantities + header. */
export function ActEditorPage() {
  const { id = '' } = useParams();
  const [searchParams] = useSearchParams();
  // Generated from one estimate's «Згенерувати акт» → scope the editor to that estimate only; from the
  // Acts tab → no scope, every SIGNED estimate is offered.
  const scopeEstimate = searchParams.get('scope');
  const navigate = useNavigate();
  const { t } = useTranslation();

  // «/acts/new»: the act has no server row yet — «Зберегти» is what creates it (master feedback:
  // «кожен раз коли ми натиснули Новий акт і повернулись назад, то акт вже створюється»). Its
  // defaults come from the query string, since there is nothing to load them from.
  const isNew = id === '';
  const act = useAct(id);
  const create = useCreateAct(searchParams.get('project') ?? '');
  const projectId = isNew ? (searchParams.get('project') ?? '') : (act.data?.projectId ?? '');
  const progress = useActProgress(projectId, Boolean(projectId));
  const updateHeader = useUpdateActHeader(id, projectId);
  const replaceItems = useReplaceActItems(id, projectId);
  const signOffline = useSignActOffline(id, projectId);
  const deleteAct = useDeleteAct(projectId);
  // The new act's id exists only after create() answers, so its refresh can't ride an id-bound hook.
  const invalidateAct = useActsInvalidator(projectId);
  // Stable across re-renders: a double tap on «Зберегти» must replay the SAME create, not mint a
  // second numbered act on the object.
  const newActUuid = useRef<string | null>(null);

  const signed = act.data?.status === 'SIGNED';
  const sent = act.data?.status === 'SENT';

  // ---- header form + entered quantities (seeded once when data arrives) ----
  const [kind, setKind] = useState<WorkActKind>('INTERIM');
  // Stage name. While the master hasn't touched it, the field mirrors the auto-title (the single
  // category all selected lines share); the first keystroke or chip tap makes it his.
  const [title, setTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [issuedAt, setIssuedAt] = useState('');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [contractRef, setContractRef] = useState('');
  const [advance, setAdvance] = useState('');
  const [showMaterials, setShowMaterials] = useState(true);
  // false, matching the server-side default — seeding overwrites it, but the pre-seed flash
  // shouldn't advertise a block the act won't render.
  const [showCumulative, setShowCumulative] = useState(false);
  // Receipts are pass-through money: booking them as MATERIALS expenses on sign keeps profit
  // honest. Off for the master who already logs his receipts in the expense journal.
  const [receiptsToExpenses, setReceiptsToExpenses] = useState(true);
  // PDF-appendix-only (master feedback): the portal always shows the photos.
  const [showReceiptPhotos, setShowReceiptPhotos] = useState(true);
  const [qty, setQty] = useState<Record<string, string>>({}); // estimateItemId → quantity
  const [additional, setAdditional] = useState<Additional[]>([]);
  const [catalogPicker, setCatalogPicker] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // The form as it was seeded or last saved — the reference the dirty check compares against.
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [savedMoney, setSavedMoney] = useState<string | null>(null);

  useEffect(() => {
    if (seeded || !isNew) return;
    // A brand-new act: today's date, the period start the caller computed off the object's acts,
    // everything else at its server-side default. No snapshot reference is set — an unsaved act is
    // «dirty» by definition, so leaving always asks.
    const today = isoDay(new Date());
    setIssuedAt(today);
    setPeriodFrom(searchParams.get('from') ?? today);
    setPeriodTo(today);
    setSeeded(true);
  }, [isNew, seeded, searchParams]);

  useEffect(() => {
    if (seeded || !act.data) return;
    const a = act.data;
    setKind(a.kind);
    setTitle(a.title ?? '');
    setTitleEdited(Boolean(a.title)); // an explicit saved name stays put; empty stays on auto
    setIssuedAt(a.issuedAt);
    setPeriodFrom(a.periodFrom);
    setPeriodTo(a.periodTo);
    setContractRef(a.contractRef ?? '');
    setAdvance(a.advanceOffset == null ? '' : String(a.advanceOffset));
    setShowMaterials(a.showMaterials);
    setShowCumulative(a.showCumulative);
    setReceiptsToExpenses(a.receiptsToExpenses);
    setShowReceiptPhotos(a.showReceiptPhotos);
    const seededQty: Record<string, string> = {};
    const seededAdditional: Additional[] = [];
    for (const it of a.items) {
      // An ADJUSTMENT has no estimateItemId either (B-55), so it would fall into «Додаткові роботи»
      // and be saved straight back as an off-estimate work — billing the estimate's own discount a
      // second time, in the ADDENDUM. The server authors it; the editor only shows the figure.
      if (it.lineKind === 'ADJUSTMENT') continue;
      if (it.estimateItemId) seededQty[it.estimateItemId] = String(it.quantity);
      else seededAdditional.push({ name: it.name, type: it.type, unit: it.unit, unitPrice: String(it.unitPrice), quantity: String(it.quantity) });
    }
    setQty(seededQty);
    setAdditional(seededAdditional);
    setSavedSnapshot(formSnapshot({
      kind: a.kind, title: a.title ?? '', issuedAt: a.issuedAt, periodFrom: a.periodFrom,
      periodTo: a.periodTo, contractRef: a.contractRef ?? '',
      advance: a.advanceOffset == null ? '' : String(a.advanceOffset),
      showMaterials: a.showMaterials, showCumulative: a.showCumulative,
      receiptsToExpenses: a.receiptsToExpenses, showReceiptPhotos: a.showReceiptPhotos,
      qty: seededQty, additional: seededAdditional,
    }));
    setSavedMoney(moneySnapshot({
      advance: a.advanceOffset == null ? '' : String(a.advanceOffset),
      showMaterials: a.showMaterials, qty: seededQty, additional: seededAdditional,
    }));
    setSeeded(true);
  }, [act.data, seeded]);

  /**
   * The lines the editor works from (review P-34). WHERE they come from is not the same question
   * before and after the signature.
   *
   * A SIGNED act is a document, not a view of the estimate: it renders its OWN items, at the price
   * and the quantity the client signed. The progress feed cannot serve it — the feed deliberately
   * skips every estimate that is no longer counted in the economy, and a signed parent stops being
   * counted the moment its duplicate is signed, so a signed act on one opened EMPTY, with
   * «Разом 0,00» printed under a document the client had already accepted.
   *
   * A DRAFT or SENT act reads the live feed instead, because the feed is what the SERVER will
   * write: an estimate-linked line takes its price, unit and quantity cap from the estimate at save
   * time (B-56), so showing the frozen copy would disagree with the figure about to be saved. What
   * the act already holds is still never thrown away — a saved line the feed no longer offers is
   * added BACK at its own frozen price, so it is shown and re-saved instead of silently un-billing
   * work the master had entered and the client may have already been shown.
   */
  const actLines = useMemo<ActProgressLine[]>(() => {
    const meta = new Map<string, { name: string | null; createdAt: string }>();
    for (const l of progress.data?.lines ?? []) {
      meta.set(l.estimateId, { name: l.estimateName, createdAt: l.estimateCreatedAt });
    }
    const fromItem = (it: WorkActItemResponse, estimateItemId: string): ActProgressLine => {
      const m = it.estimateId ? meta.get(it.estimateId) : undefined;
      return {
        estimateId: it.estimateId ?? ACT_OWN_LINES,
        // Nothing left to name it with (the estimate FK is ON DELETE SET NULL, and an un-counted
        // estimate is absent from the feed): say where the lines DO come from rather than invent a
        // «Кошторис від …» that opens nothing.
        estimateName: m ? m.name : t('acts.linesFromAct'),
        estimateCreatedAt: m?.createdAt ?? '',
        estimateItemId, type: it.type, name: it.name, category: it.category, unit: it.unit,
        unitPrice: it.unitPrice,
        // The act's own arithmetic, so the line still reads as progress: what earlier acts closed,
        // what THIS one closes, and the sum of the two as the position it was cut from.
        estimateQuantity: it.cumulativeBefore + it.quantity,
        done: it.cumulativeBefore,
        remaining: it.quantity,
      };
    };
    const saved = (act.data?.items ?? []).filter((it) => it.lineKind !== 'ADJUSTMENT');
    const own = (it: WorkActItemResponse): ActProgressLine[] =>
      it.estimateItemId ? [fromItem(it, it.estimateItemId)] : [];
    if (signed) return saved.flatMap(own);
    const live = (progress.data?.lines ?? [])
      .filter((l) => !scopeEstimate || l.estimateId === scopeEstimate);
    const offered = new Set(live.map((l) => l.estimateItemId));
    const orphans = saved.flatMap((it) =>
      it.estimateItemId && !offered.has(it.estimateItemId) ? own(it) : []);
    return [...live, ...orphans];
  }, [signed, act.data, progress.data, scopeEstimate, t]);

  // Grouped by estimate, the same shape as the act PDF. When scoped to one estimate (generated from
  // its «Згенерувати акт») only that estimate's positions are offered; unscoped (from the Acts tab),
  // every SIGNED estimate is — the filter lives in `actLines`, so nothing can be scoped away after
  // it was saved.
  const groups = useMemo(() => {
    const byEstimate = new Map<string, { name: string; lines: ActProgressLine[] }>();
    for (const line of actLines) {
      const g = byEstimate.get(line.estimateId)
        ?? { name: estimateName(line.estimateName, line.estimateCreatedAt), lines: [] };
      g.lines.push(line);
      byEstimate.set(line.estimateId, g);
    }
    return [...byEstimate.entries()];
  }, [actLines]);

  // Every SIGNED-estimate line by name → the estimates that carry it. An off-estimate «додаткова»
  // line whose name matches one warns the master it already lives in a real estimate (where it can be
  // ticked as done instead of added loose) — he decides. Spans ALL estimates, even hidden ones.
  const estimatesByLineName = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const line of progress.data?.lines ?? []) {
      const key = line.name.trim().toLowerCase();
      if (!key) continue;
      const set = map.get(key) ?? new Set<string>();
      set.add(estimateName(line.estimateName, line.estimateCreatedAt));
      map.set(key, set);
    }
    return map;
  }, [progress.data]);

  // Every field that has to READ before the act can be written. A wholly blank additional row is
  // not an error — it is the empty row the «+» just added; a row with anything in it must read.
  const qtyErrors = useMemo(() => {
    const bad = new Set<string>();
    for (const [key, raw] of Object.entries(qty)) if (qtyOf(raw) === null) bad.add(key);
    return bad;
  }, [qty]);
  const additionalErrors = useMemo(() => {
    const bad = new Set<number>();
    additional.forEach((a, i) => {
      if (a.name.trim() === '' && a.quantity.trim() === '' && a.unitPrice.trim() === '') return;
      if (qtyOf(a.quantity) === null || moneyOf(a.unitPrice) === null) bad.add(i);
    });
    return bad;
  }, [additional]);
  const advanceInvalid = moneyOf(advance) === null;
  const invalid = qtyErrors.size > 0 || additionalErrors.size > 0 || advanceInvalid;

  // WYSIWYG (review fix): the act contains exactly what the editor shows. With «Показувати
  // матеріали» off, MATERIAL estimate lines are hidden — so they must not count into the total nor
  // be saved, or an invisible position would still be billed (entered quantities are kept in state,
  // so ticking the box back restores them). Additional works always count: the master added them
  // explicitly and their section never hides.
  //
  // Each line is rounded to the kopeck and the sum is added IN kopecks (review P-34/P-39): the
  // server stores every line at scale 2 and adds those, so a float chain here drifts away from the
  // figure the client is about to sign — on the one screen that exists to show that figure.
  const total = useMemo(() => {
    const parts: number[] = [];
    for (const line of actLines) {
      if (!showMaterials && line.type === 'MATERIAL') continue;
      parts.push(num(qty[line.estimateItemId] ?? '') * line.unitPrice);
    }
    for (const a of additional) parts.push(num(a.quantity) * money(a.unitPrice));
    return sumMoney(parts);
  }, [qty, additional, actLines, showMaterials]);
  // «Знижка/надбавка за кошторисом» (B-55): the estimate's own «% від кошторису», prorated by what
  // this act closes. The SERVER authors it on every save — the editor cannot recompute it (the
  // progress endpoint deliberately drops «%» lines, they have no quantity to close), so it shows
  // the figure from the last save and says so while the quantities are dirty. Leaving it out
  // altogether is the one thing that is not an option: it would show a −10 % estimate's act at its
  // gross price, which is 2 000 ₴ the client never agreed to.
  const adjustments = (act.data?.items ?? []).filter((i) => i.lineKind === 'ADJUSTMENT');
  const adjustmentsTotal = sumMoney(adjustments.map((i) => i.lineTotal));
  const billedTotal = sumMoney([total, adjustmentsTotal]);
  // Shown in the «Додаткові роботи» panel header — the one figure that says whether the block is
  // worth opening on a phone.
  const additionalTotal = useMemo(
    () => sumMoney(additional.map((a) => num(a.quantity) * money(a.unitPrice))), [additional]);
  // Receipts are saved the moment they are added, so they come straight off the loaded act — they
  // are money the client owes on this act, hence inside «До сплати», not a decorative appendix.
  //
  // Merged with whatever the phone is still carrying (offline-act-receipts) HERE, at the one place
  // both the panel and this page's «До сплати» read from: a receipt photographed in a basement is
  // money the master has already spent, and a total that quietly ignores it until the queue drains
  // is the same lie in the opposite direction as losing the photo.
  const { queued, refresh: refreshQueued } = usePendingActReceipts(id);
  const receipts = mergeQueuedReceipts(act.data?.receipts ?? [], queued);
  // Itemized receipts are reference-only — their positions already bill the money as act lines.
  // `billedOf` (not `amount`) — a partial return must reach «До сплати» here exactly as it reaches
  // the receipts panel's own subtotal and the server's `payable`.
  const receiptsTotal = sumMoney(receipts.filter((r) => !r.itemized).map((r) => billedOf(r)));
  const payable = Math.max(0, sumMoney([billedTotal, receiptsTotal, -money(advance)]));

  // What «Зараховано авансу» is FOR, said in the object's own numbers instead of left to the
  // master's memory: money the client has already paid that no SIGNED act has accepted yet
  // (`received − acceptedByActs` — the same figure the economy tab shows as «Невідпрацьований
  // аванс»). It nets itself across acts: an advance credited on an earlier act is accepted work
  // there, so the remainder shrinks on its own — which is the one guard against crediting the
  // same advance twice. `null` while the economy is unknown (loading/offline) — then the field
  // simply says nothing rather than guessing.
  const economy = useEconomy(projectId);
  const unearnedAdvance = useMemo(() => {
    const a = economy.data?.acts;
    return a ? Math.max(0, a.received - a.acceptedByActs) : null;
  }, [economy.data]);
  // Never more than this act is worth — `payable` floors at 0 anyway, and offering to credit more
  // than the act bills would read as «the rest carries over», which nothing implements.
  const advanceSuggestion = roundMoney(Math.min(unearnedAdvance ?? 0, billedTotal + receiptsTotal));

  // Auto-title (master feedback): when every selected estimate line shares ONE category, that
  // category IS the act's stage name — offer it live until the master types his own.
  const autoTitle = useMemo(() => {
    const cats = new Set<string>();
    for (const line of actLines) {
      if (!showMaterials && line.type === 'MATERIAL') continue;
      if (num(qty[line.estimateItemId] ?? '') <= 0) continue;
      cats.add((line.category ?? '').trim());
    }
    return cats.size === 1 ? [...cats][0] : '';
  }, [qty, actLines, showMaterials]);
  const effectiveTitle = titleEdited ? title : autoTitle;

  // Name suggestions = the object's own estimate categories (Демонтаж, Штукатурні роботи, …) —
  // the master's real vocabulary, no hardcoded template list to maintain.
  const titleSuggestions = useMemo(() => {
    const seen: string[] = [];
    for (const line of actLines) {
      if (line.remaining <= 0) continue; // a fully closed stage is not a name for the NEXT act
      const c = (line.category ?? '').trim();
      if (c && !seen.includes(c)) seen.push(c);
    }
    return seen.slice(0, 8);
  }, [actLines]);

  // Dirty = the form drifted from its seeded/last-saved snapshot. A signed act is read-only, so it
  // can never be dirty; before seeding there is nothing to lose. Uses the EFFECTIVE title, so the
  // auto-title counts as a pending change exactly when it would be saved.
  const currentSnapshot = formSnapshot({
    kind, title: effectiveTitle, issuedAt, periodFrom, periodTo, contractRef, advance,
    showMaterials, showCumulative, receiptsToExpenses, showReceiptPhotos, qty, additional,
  });
  const currentMoney = moneySnapshot({ advance, showMaterials, qty, additional });
  // An unsaved new act is dirty by definition: there is no server row behind it, so leaving always
  // asks (master feedback — a mistaken tap used to leave a real numbered act on the object).
  const dirty = seeded && !signed
    && (isNew || (savedSnapshot !== null && currentSnapshot !== savedSnapshot));

  // Review P-34. Once the form is exactly what the server holds and nothing is still queued on the
  // phone, the SERVER's own figures are the ones shown — they are what the PDF prints, what the
  // portal shows the client and what the economy counts, and the editor recomputing its own answer
  // beside them is how the two quietly disagree. `total` there is the sum of EVERY stored line, the
  // B-55 adjustment included, so the «Разом» row takes it back out and the adjustment keeps its
  // own row underneath. While the form IS dirty the local arithmetic is the only honest answer:
  // it is showing money that has not been saved yet.
  const moneyClean = seeded && !isNew && savedMoney !== null && currentMoney === savedMoney;
  const serverTotals = moneyClean && !act.isFetching && queued.size === 0 ? act.data ?? null : null;
  const shownTotal = serverTotals ? roundMoney(serverTotals.total - adjustmentsTotal) : total;
  const shownReceiptsTotal = serverTotals ? serverTotals.receiptsTotal : receiptsTotal;
  const shownPayable = serverTotals ? serverTotals.payable : payable;
  // In-app back/swipe with unsaved edits → a ConfirmDialog instead of silent loss (review fix).
  // The ref lets the post-delete navigation pass through: the entity is gone, there is nothing
  // left to save, and the guard would otherwise fire before React re-renders with dirty=false.
  const skipLeaveGuard = useRef(false);
  const leaveBlocker = useLeaveGuard(dirty, skipLeaveGuard);

  // At least one line with a quantity — the gate for signing (mirrors the backend's empty-act
  // guard: a SIGNED act is immutable and undeletable, so an empty one must never get that far).
  const hasLines = useMemo(() => {
    for (const line of actLines) {
      if (!showMaterials && line.type === 'MATERIAL') continue;
      if (num(qty[line.estimateItemId] ?? '') > 0) return true;
    }
    return additional.some((a) => num(a.quantity) > 0 && a.name.trim() !== '');
  }, [qty, additional, actLines, showMaterials]);

  if ((!isNew && act.isPending) || (Boolean(projectId) && progress.isPending)) {
    return <div className="py-16 text-center text-brand"><Spinner /></div>;
  }
  if (!isNew && !act.data) {
    return <p className="py-10 text-center text-sm text-muted">{t('acts.loadError')}</p>;
  }

  const toggleLine = (line: ActProgressLine) => {
    setQty((q) => {
      const next = { ...q };
      if (num(next[line.estimateItemId] ?? '') > 0) delete next[line.estimateItemId];
      else next[line.estimateItemId] = String(line.remaining);
      return next;
    });
  };

  // Group tick (master feedback): one tap selects a whole work stage — every line of the category
  // fills its remainder (manually typed quantities are left as typed); tapping a fully selected
  // group clears it.
  const toggleCategory = (lines: ActProgressLine[]) => {
    setQty((q) => {
      const next = { ...q };
      const fillable = lines.filter((l) => l.remaining > 0);
      const allTicked = fillable.length > 0
        && fillable.every((l) => num(next[l.estimateItemId] ?? '') > 0);
      if (allTicked) {
        for (const l of lines) delete next[l.estimateItemId];
      } else {
        for (const l of fillable) {
          if (num(next[l.estimateItemId] ?? '') <= 0) next[l.estimateItemId] = String(l.remaining);
        }
      }
      return next;
    });
  };

  const buildItems = (): WorkActItemLine[] => {
    const lines: WorkActItemLine[] = [];
    for (const line of actLines) {
      if (!showMaterials && line.type === 'MATERIAL') continue; // hidden ⇒ not in the act (WYSIWYG)
      const q = num(qty[line.estimateItemId] ?? '');
      if (q > 0) {
        lines.push({
          estimateItemId: line.estimateItemId, estimateId: line.estimateId, type: line.type,
          name: line.name, category: line.category, unit: line.unit, unitPrice: line.unitPrice, quantity: q,
        });
      }
    }
    for (const a of additional) {
      if (num(a.quantity) > 0 && a.name.trim()) {
        lines.push({
          estimateItemId: null, estimateId: null, type: a.type, name: a.name.trim(),
          category: null, unit: a.unit, unitPrice: money(a.unitPrice), quantity: num(a.quantity),
        });
      }
    }
    return lines;
  };

  const headerRequest = () => ({
    kind, issuedAt, periodFrom, periodTo,
    title: effectiveTitle.trim() || null,
    contractRef: contractRef.trim() || null,
    advanceOffset: advance.trim() === '' ? null : money(advance),
    showMaterials, showCumulative,
  });

  /**
   * Write header + lines and answer with the id the act now lives under. On «/acts/new» this is
   * where the act is BORN — «Новий акт» only opens the editor, so a mistaken tap and a Back leave
   * nothing behind. The two receipt toggles are update-only fields; they can't have been touched on
   * a new act (the receipts section needs a saved row), so create sends the header alone.
   */
  const persist = async (): Promise<string> => {
    if (!isNew) {
      await updateHeader.mutateAsync({ ...headerRequest(), receiptsToExpenses, showReceiptPhotos });
      await replaceItems.mutateAsync({ items: buildItems() });
      return id;
    }
    newActUuid.current ??= newUuid(); // X-Entity-Uuid — a retried create must not double-number
    const created = await create.mutateAsync({ req: headerRequest(), id: newActUuid.current });
    await actsApi.replaceItems(created.id, { items: buildItems() });
    // «Новий акт» creates nothing — THIS is where an act is born, and it is the only place, so
    // «Зберегти» and «Підписати» both count once each through the door they already share. Counted
    // only once the LINES have landed as well: fired before them, a failed `replaceItems` left
    // PostHog holding an act the master never got, against a backend that records the real one.
    track('act_created');
    invalidateAct(created.id);
    return created.id;
  };

  const onSave = async () => {
    // Review P-35. Nothing is written while a field cannot be read: mapping it to 0 saved an
    // additional work as a free line and credited an advance that vanished, both silently, both
    // into a document the client is about to sign.
    if (invalid) {
      toast.error(t('acts.fixFields'));
      return;
    }
    try {
      const savedId = await persist();
      setSavedSnapshot(currentSnapshot); // the form as sent is now the saved reference
      setSavedMoney(currentMoney);
      toast.success(t('acts.saved'));
      if (isNew) {
        // The act has a row now: move onto its real URL so receipts, share and PDF address it.
        // Nothing is left unsaved, so the leave guard must let this navigation through.
        skipLeaveGuard.current = true;
        void navigate(routes.act(savedId), { replace: true });
      }
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const onSign = async () => {
    if (!signerName.trim()) return;
    if (invalid) {
      toast.error(t('acts.fixFields'));
      return;
    }
    try {
      // Persist current edits first so the signed act reflects the screen (creating it, if this is
      // still «/acts/new» — the master may fill an act and sign it in one sitting).
      const actId = await persist();
      if (isNew) {
        await actsApi.signOffline(actId, { signerName: signerName.trim() });
        invalidateAct(actId);
      } else {
        await signOffline.mutateAsync(signerName.trim());
      }
      // The OFFLINE signature only — the master signing on the client's behalf, in their own
      // browser. A portal signature happens in the client's browser and is never measured.
      track('act_signed', { mode: 'offline' });
      setSavedSnapshot(currentSnapshot); // everything on screen is persisted (and now immutable)
      setSavedMoney(currentMoney);
      setSignOpen(false);
      toast.success(t('acts.signed'));
      if (isNew) {
        skipLeaveGuard.current = true;
        void navigate(routes.act(actId), { replace: true });
      }
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const onPdf = async () => {
    try {
      // Reserved-tab helper — window.open() after the awaited fetch silently fails on iOS Safari.
      await openPdfTab(() => actsApi.fetchPdf(id));
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  // Off-estimate work is work the client never signed for, so say it once — whichever way the row
  // is created (typed by hand or taken from the catalog).
  const warnAboutAdditional = () => {
    if (typeof localStorage !== 'undefined' && !localStorage.getItem(ADDITIONAL_WARNED_KEY)) {
      localStorage.setItem(ADDITIONAL_WARNED_KEY, '1');
      toast.info(t('acts.additionalWarn'));
    }
  };

  const addAdditional = () => {
    warnAboutAdditional();
    setAdditional((a) => [...a, { name: '', type: 'WORK', unit: 'M2', unitPrice: '', quantity: '' }]);
  };

  // «Оформити перевищення як додаткові роботи»: clamp the estimate line to its remainder and move
  // the overflow into a new additional-works row (off-estimate work the client must agree to).
  const convertExcess = (line: ActProgressLine) => {
    const entered = num(qty[line.estimateItemId] ?? '');
    const excess = entered - line.remaining;
    if (excess <= 0) return;
    setQty((q) => ({ ...q, [line.estimateItemId]: String(line.remaining) }));
    setAdditional((a) => [...a, {
      name: `${line.name} ${t('acts.excessSuffix')}`,
      type: line.type, unit: line.unit, unitPrice: String(line.unitPrice), quantity: String(excess),
    }]);
  };

  return (
    <div className="mx-auto max-w-2xl px-4 pb-28 pt-2 sm:px-6">
      {/* Top bar: «Зберегти» and «Поділитися» on the screen itself (master feedback — hunting for
          Save in the FAB after every edit was the loudest complaint). STATIC, not sticky (round 2):
          no other screen pins its header, and the sticky variant shipped with a non-existent
          `bg-app` class — a transparent strip that scrolled-past lines showed through. Deep in the
          scroll the FAB still carries Save. */}
      <div className="mb-3 flex items-center gap-2">
        <button type="button" onClick={() => navigate(routes.project(projectId) + '?tab=acts')}
          aria-label={t('common.back')}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-lg text-primary">←</button>
        {/* A new act has no number or status yet — both are the server's, minted on «Зберегти». */}
        <span className="truncate text-sm font-semibold text-primary">
          {act.data ? t('acts.title', { number: act.data.number }) : t('acts.newTitle')}
        </span>
        {act.data && (
          <span className="shrink-0">
            <Badge variant={ACT_STATUS_VARIANT[act.data.status]}>{t('acts.status.' + act.data.status)}</Badge>
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {act.data && (
            <button type="button" onClick={() => setShareOpen(true)} aria-label={t('acts.share')}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-sunken text-base text-primary">🔗</button>
          )}
          {!signed && (
            <Button className="px-3 py-2"
              loading={create.isPending || updateHeader.isPending || replaceItems.isPending}
              onClick={() => void onSave()}>
              {dirty ? t('common.save') + ' •' : t('common.save')}
            </Button>
          )}
        </div>
      </div>

      {/* Header — the act’s own fields, titled like every other block so the editor reads as a
          stack of panels rather than one long form. */}
      <Section title={t('acts.detailsTitle')} flush>
        <div className="space-y-3">
        <div className="flex gap-1 rounded-xl bg-surface-sunken p-1">
          {(['INTERIM', 'FINAL'] as WorkActKind[]).map((k) => (
            <button key={k} type="button" disabled={signed} onClick={() => setKind(k)}
              className={'flex-1 rounded-lg py-2 text-sm font-semibold transition-colors '
                + (kind === k ? 'bg-white text-brand shadow-sm' : 'text-muted')}>
              {t('acts.kind.' + k)}
            </button>
          ))}
        </div>
        <Field label={t('acts.titleLabel')}>
          <Input value={effectiveTitle} disabled={signed}
            onChange={(e) => { setTitle(e.target.value); setTitleEdited(true); }} />
          {!signed && titleSuggestions.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {titleSuggestions.map((c) => (
                <button key={c} type="button"
                  onClick={() => { setTitle(c); setTitleEdited(true); }}
                  className={'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors '
                    + (effectiveTitle === c
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-border bg-surface text-secondary')}>
                  {c}
                </button>
              ))}
            </div>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('acts.periodFrom')}><Input type="date" value={periodFrom} disabled={signed} onChange={(e) => setPeriodFrom(e.target.value)} /></Field>
          <Field label={t('acts.periodTo')}><Input type="date" value={periodTo} disabled={signed} onChange={(e) => setPeriodTo(e.target.value)} /></Field>
        </div>
        <Field label={t('acts.issuedAt')}><Input type="date" value={issuedAt} disabled={signed} onChange={(e) => setIssuedAt(e.target.value)} /></Field>
        <Field label={t('acts.contractRef')}><Input value={contractRef} disabled={signed} onChange={(e) => setContractRef(e.target.value)} /></Field>
        {!signed && (
          <Checkbox label={t('acts.showMaterials')} checked={showMaterials} onChange={() => setShowMaterials((v) => !v)} />
        )}
        </div>
      </Section>

      {/* Progress lines — grouped estimate → category (same shape as the act PDF), with a group
          tick per category so a whole work stage selects in one tap (master feedback). */}
      {groups.map(([estimateId, group]) => {
        const visible = group.lines.filter((line) =>
          (showMaterials || line.type !== 'MATERIAL')
          // A line fully closed by earlier SIGNED acts is not offered again (master feedback) —
          // finished work is finished; extra work goes through «Додаткові роботи». It stays
          // visible only while THIS draft already carries a quantity for it, so nothing saved
          // ever disappears silently.
          && (line.remaining > 0 || num(qty[line.estimateItemId] ?? '') > 0));
        if (visible.length === 0) return null; // the whole estimate is closed — nothing to offer
        const categories = categorize(visible);
        const sectioned = categories.length > 1 || (categories.length === 1 && categories[0][0] !== '');
        const groupTotal = sumMoney(
          visible.map((l) => num(qty[l.estimateItemId] ?? '') * l.unitPrice));
        return (
        <Section key={estimateId} title={group.name}
          aside={groupTotal > 0 ? formatMoney(groupTotal) : undefined}>
          {/* Same reason as the estimate board: a replay must not read the positions, the
              quantities being accepted, or the money on them. */}
          <div className="ph-mask space-y-2">
            {categories.map(([cat, lines]) => {
              const fillable = lines.filter((l) => l.remaining > 0);
              const allTicked = fillable.length > 0
                && fillable.every((l) => num(qty[l.estimateItemId] ?? '') > 0);
              return (
              <div key={cat || '·'} className="space-y-2">
                {sectioned && (
                  <label className="flex items-center gap-2 px-1 pt-1">
                    <input type="checkbox" checked={allTicked}
                      disabled={signed || fillable.length === 0}
                      onChange={() => toggleCategory(lines)}
                      className="h-4 w-4 accent-brand" />
                    <span className="text-xs font-semibold text-secondary">{cat || t('acts.noCategory')}</span>
                  </label>
                )}
                {lines.map((line) => {
                const entered = num(qty[line.estimateItemId] ?? '');
                const badQty = qtyErrors.has(line.estimateItemId);
                const exceeds = line.done + entered > line.estimateQuantity;
                return (
                  <div key={line.estimateItemId} className="rounded-card border border-border bg-surface p-3">
                    <div className="flex items-start gap-2">
                      {/* Closed lines are filtered out above, so a rendered line is always
                          tickable; unticking a closed-but-entered line removes it from the act
                          (and, being closed, from the picker). */}
                      <input type="checkbox" disabled={signed} checked={entered > 0}
                        onChange={() => toggleLine(line)} className="mt-1 h-5 w-5 accent-brand" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-medium text-primary">{line.name}</span>
                          <span className="whitespace-nowrap text-xs text-muted">{formatMoney(line.unitPrice)}/{t('units.' + line.unit)}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted">
                          {t('acts.lineProgress', {
                            estimate: formatAmount(line.estimateQuantity),
                            done: formatAmount(line.done),
                            remaining: formatAmount(line.remaining),
                            unit: t('units.' + line.unit),
                          })}
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <Input type="text" inputMode="decimal" value={qty[line.estimateItemId] ?? ''} disabled={signed}
                            invalid={badQty}
                            onChange={(e) => setQty((q) => ({ ...q, [line.estimateItemId]: e.target.value }))}
                            className="w-28" />
                          <span className="text-xs text-muted">{t('units.' + line.unit)}</span>
                          <span className="ml-auto text-sm font-semibold text-primary">
                            {formatMoney(badQty ? 0 : roundMoney(entered * line.unitPrice))}
                          </span>
                        </div>
                        {badQty && <p className="mt-1 text-xs text-danger">{t('validation.badQuantity')}</p>}
                        {exceeds && !signed && (
                          <div className="mt-1 rounded-lg bg-amber-50 p-2">
                            <p className="text-xs text-amber-700">{t('acts.exceeds')}</p>
                            <button type="button" onClick={() => convertExcess(line)}
                              className="mt-1 text-xs font-semibold text-brand">{t('acts.convertExcess')}</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
                })}
              </div>
              );
            })}
          </div>
        </Section>
        );
      })}

      {/* Additional works */}
      <Section title={t('acts.additionalTitle')} info={t('acts.additionalInfo')}
        aside={additionalTotal > 0 ? formatMoney(additionalTotal) : undefined}>
        <div className="space-y-2">
          {additional.map((a, i) => {
            const dupEstimates = [...(estimatesByLineName.get(a.name.trim().toLowerCase()) ?? [])];
            const badRow = additionalErrors.has(i);
            return (
            <div key={i} className="rounded-card border border-border bg-surface p-3">
              {signed ? (
                <Input value={a.name} disabled />
              ) : (
                <CatalogAutocomplete
                  value={a.name}
                  placeholder={t('acts.additionalName')}
                  onChange={(text) => setAdditional((list) => list.map((x, j) => j === i ? { ...x, name: text } : x))}
                  onPick={(item) => setAdditional((list) => list.map((x, j) => j === i
                    ? { ...x, name: item.name, type: item.type, unit: item.unit, unitPrice: String(item.defaultPrice) }
                    : x))}
                />
              )}
              {!signed && dupEstimates.length > 0 && (
                <p className="mt-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">
                  {t('acts.additionalDuplicate', { names: dupEstimates.join(', ') })}
                </p>
              )}
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Select value={a.unit} disabled={signed}
                  onChange={(e) => setAdditional((list) => list.map((x, j) => j === i ? { ...x, unit: e.target.value as Unit } : x))}>
                  {ACT_UNITS.map((code) => <option key={code} value={code}>{t('units.' + code)}</option>)}
                </Select>
                <Input inputMode="decimal" placeholder={t('acts.qty')} value={a.quantity} disabled={signed}
                  invalid={badRow && qtyOf(a.quantity) === null}
                  onChange={(e) => setAdditional((list) => list.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} />
                <Input inputMode="decimal" placeholder={t('acts.price')} value={a.unitPrice} disabled={signed}
                  invalid={badRow && moneyOf(a.unitPrice) === null}
                  onChange={(e) => setAdditional((list) => list.map((x, j) => j === i ? { ...x, unitPrice: e.target.value } : x))} />
              </div>
              {badRow && <p className="mt-1 text-xs text-danger">{t('validation.badNumber')}</p>}
              {!signed && (
                <button type="button" className="mt-1.5 text-xs font-semibold text-danger"
                  onClick={() => setAdditional((list) => list.filter((_, j) => j !== i))}>{t('common.delete')}</button>
              )}
            </div>
            );
          })}
        </div>
        {/* Two doors, the same two everywhere else a position is added: browse the catalog, or type
            it. Acts only ever had the type-ahead, which answers «як це називалось?» but not «що я
            взагалі роблю на цьому об'єкті» — the browse picker is the one that shows the trade. */}
        {!signed && (
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
            <button type="button" onClick={() => setCatalogPicker(true)}
              className="text-sm font-semibold text-brand">{t('acts.addAdditionalFromCatalog')}</button>
            <button type="button" onClick={addAdditional}
              className="text-sm font-semibold text-brand">{t('acts.addAdditional')}</button>
          </div>
        )}
      </Section>

      <Modal open={catalogPicker} onClose={() => setCatalogPicker(false)} size="lg"
        title={t('acts.additionalFromCatalogTitle')}>
        <CatalogPicker
          hint={t('acts.additionalQtyHint')}
          onPick={(picks) => {
            warnAboutAdditional();
            setAdditional((list) => [...list, ...picks.map((item) => ({
              name: item.name, type: item.type, unit: item.unit,
              unitPrice: String(item.defaultPrice), quantity: '',
            }))]);
            setCatalogPicker(false);
            return Promise.resolve();
          }}
        />
      </Modal>

      {/* A receipt is an upload against a real act row (and its photo is mandatory), so the section
          waits for the first save instead of holding a pile of files in memory. */}
      {isNew ? (
        <Section title={t('acts.receiptsTitle')} info={t('acts.receiptsInfo')}>
          <p className="text-sm text-muted">{t('acts.receiptsAfterSave')}</p>
        </Section>
      ) : (
        <ActReceiptsSection actId={id} projectId={projectId} receipts={receipts} signed={signed}
          sent={sent}
          queued={queued} onQueuedChanged={refreshQueued}
          toExpenses={receiptsToExpenses} onToExpensesChange={setReceiptsToExpenses}
          showPhotosInPdf={showReceiptPhotos} onShowPhotosInPdfChange={setShowReceiptPhotos} />
      )}

      {/* The bill. Its own panel because it is the block the master and the client both read last,
          and «Зараховано авансу» is an input that changes the figure right under it. */}
      <Section title={t('acts.settlementTitle')} flush>
        {!signed && (
          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-sm font-medium text-secondary">{t('acts.advance')}</span>
              <InfoPopover text={t('acts.advanceInfo')} />
            </div>
            <Input inputMode="decimal" value={advance} invalid={advanceInvalid}
              onChange={(e) => setAdvance(e.target.value)} className="max-w-[200px]" />
            {advanceInvalid
              ? <p className="mt-1 text-xs text-danger">{t('validation.badNumber')}</p>
              : <p className="mt-1 text-xs text-muted">{t('acts.advanceHint')}</p>}
            {unearnedAdvance != null && unearnedAdvance > 0 && (
              <div className="mt-2 rounded-card border border-border bg-surface p-2.5">
                <p className="text-xs text-secondary">
                  {t('acts.advanceUnearned', { amount: formatMoney(unearnedAdvance) })}
                </p>
                {advanceSuggestion > 0 && money(advance) !== advanceSuggestion && (
                  <button type="button" className="mt-1.5 text-xs font-semibold text-brand"
                    onClick={() => setAdvance(String(advanceSuggestion))}>
                    {t('acts.advanceApply', { amount: formatMoney(advanceSuggestion) })}
                  </button>
                )}
              </div>
            )}
            {unearnedAdvance === 0 && (
              <p className="mt-2 text-xs text-muted">{t('acts.advanceNone')}</p>
            )}
            {/* The one thing nothing else can catch: the same advance credited on two acts. It is a
                warning, not a block — the master may be crediting money he never logged as a payment. */}
            {unearnedAdvance != null && money(advance) > unearnedAdvance && (
              <p className="mt-2 rounded-card bg-amber-50 p-2 text-xs text-amber-700">
                {t('acts.advanceOverUnearned', { amount: formatMoney(unearnedAdvance) })}
              </p>
            )}
          </div>
        )}
        <div className={(signed ? '' : 'mt-3 border-t border-border pt-3 ') + 'space-y-1 text-sm'}>
          <Row label={t('acts.total')} value={formatMoneyExact(shownTotal)} />
          {adjustments.map((a) => (
            <Row key={a.id} label={a.name} value={formatMoneyExact(a.lineTotal)} />
          ))}
          {adjustments.length > 0 && dirty && (
            <p className="text-xs text-muted">{t('acts.adjustmentRecalc')}</p>
          )}
          {shownReceiptsTotal > 0 && <Row label={t('acts.receiptsTotal')} value={formatMoneyExact(shownReceiptsTotal)} />}
          {money(advance) > 0 && <Row label={t('acts.advanceShort')} value={'− ' + formatMoneyExact(money(advance))} />}
          <Row label={t('acts.payable')} value={formatMoneyExact(shownPayable)} bold />
          {invalid && <p className="text-xs text-danger">{t('acts.fixFields')}</p>}
        </div>
        {!signed && (
          <div className="mt-3 border-t border-border pt-3">
            <Checkbox label={t('acts.showCumulative')} checked={showCumulative} onChange={() => setShowCumulative((v) => !v)} />
          </div>
        )}
      </Section>

      {/* Actions — a speed-dial FAB so the master reaches Save/Sign/Share/PDF/Delete from anywhere on a
          long editor without scrolling to the bottom. Ordered so the primary Save sits nearest the
          thumb and the destructive Delete sits farthest from it. */}
      <Fab ariaLabel={t('acts.actionsMenu')} position="bottom-6 right-4 lg:bottom-8 lg:right-8">
        {(close) => (
          <>
            {/* Delete / PDF / share all address a server row — an unsaved new act has none. */}
            {(act.data?.status === 'DRAFT' || act.data?.status === 'REJECTED') && (
              <FabAction icon="🗑" label={t('common.delete')} onClick={() => close(() => setConfirmDelete(true))} />
            )}
            {act.data && <FabAction icon="📄" label={t('acts.pdf')} onClick={() => close(() => void onPdf())} />}
            {/* Same sheet as the top bar's 🔗. Duplicated on purpose: deep in a long editor the top
                bar is scrolled away, and «поділитися» is exactly what the master reaches for there. */}
            {act.data && (
              <FabAction icon="🔗" label={t('acts.share')} onClick={() => close(() => setShareOpen(true))} />
            )}
            {!signed && (
              <FabAction icon="✍️" label={t('acts.sign')} onClick={() => close(() => {
                // An unreadable field is caught BEFORE the signature sheet opens: the master types
                // the client's name, taps «Підписати» and only then learns nothing was saved.
                if (invalid) {
                  toast.error(t('acts.fixFields'));
                  return;
                }
                if (!hasLines) {
                  toast.info(t('acts.emptyHint'));
                  return;
                }
                setSignOpen(true);
              })} />
            )}
            {!signed && (
              <FabAction icon="💾" label={t('common.save')} onClick={() => close(() => void onSave())} />
            )}
          </>
        )}
      </Fab>

      <Modal open={signOpen} onClose={() => setSignOpen(false)} title={t('acts.signTitle')}>
        <div className="space-y-3">
          <p className="text-sm text-muted">{t('acts.signHint')}</p>
          <Input placeholder={t('acts.signerName')} value={signerName} onChange={(e) => setSignerName(e.target.value)} />
          <Button fullWidth loading={signOffline.isPending} disabled={!signerName.trim() || !hasLines} onClick={() => void onSign()}>
            {t('acts.signConfirm')}
          </Button>
        </div>
      </Modal>

      <ConfirmDialog open={confirmDelete} title={t('acts.deleteTitle')} message={t('acts.deleteConfirm')}
        confirmLabel={t('common.delete')} loading={deleteAct.isPending}
        onConfirm={() => deleteAct.mutate(id, {
          onSuccess: () => {
            // The act is gone — there is nothing left to save, let the exit pass the leave guard.
            skipLeaveGuard.current = true;
            void navigate(routes.project(projectId) + '?tab=acts');
          },
          onError: (err) => toast.error(toAppError(err).message),
        })}
        onClose={() => setConfirmDelete(false)} />

      {!isNew && <ActShareSheet actId={id} open={shareOpen} onClose={() => setShareOpen(false)} />}

      {/* Unsaved edits + an in-app back/swipe → an explicit choice instead of silent loss. */}
      <ConfirmDialog
        open={leaveBlocker.state === 'blocked'}
        title={t('acts.leaveTitle')}
        message={isNew ? t('acts.leaveNewText') : t('acts.leaveText')}
        confirmLabel={t('acts.leaveConfirm')}
        onConfirm={() => { if (leaveBlocker.state === 'blocked') leaveBlocker.proceed(); }}
        onClose={() => { if (leaveBlocker.state === 'blocked') leaveBlocker.reset(); }} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-muted">{label}</span>{children}</label>;
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={'flex justify-between ' + (bold ? 'font-bold text-primary' : 'text-secondary')}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}
