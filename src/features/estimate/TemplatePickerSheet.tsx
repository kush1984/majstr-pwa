import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { InfoPopover } from '@/components/InfoPopover.tsx';
import { OfflineNotCached } from '@/components/OfflineNotCached.tsx';
import { useOnline } from '@/lib/useOnline.ts';
import { cn } from '@/lib/cn.ts';
import { TRADE_EMOJI, CUSTOM_TRADE_EMOJI } from '@/lib/labels.ts';
import { parseCustomTradeKey } from '@/features/catalog/TradeFilterChips.tsx';
import type { EstimateTemplateSummary, Trade } from '@/api/types.ts';
import { toTemplateTree, type TemplateBranch } from './templateTree.ts';
import { useEstimateTemplate, useEstimateTemplates } from './useEstimateTemplates.ts';

/**
 * At or below this many bundles a level opens by default — a short list was never the problem,
 * and collapsing it would only add a tap. Lower than the catalog picker's cap because a template
 * row is two lines tall and carries a chevron of its own.
 */
const AUTO_EXPAND_MAX_TEMPLATES = 6;

/** One bundle the master picked, plus the positions ticked inside it — `itemIds: null` is the
 *  whole bundle, which is what a bundle nobody drilled into means. */
export type TemplatePick = { template: EstimateTemplateSummary; itemIds: string[] | null };

/**
 * Picks estimate templates: lists the master's own and the system defaults grouped by trade, lets
 * them preview a bundle's composition, then hands the chosen ones back via `onPick`. The caller
 * decides what to do with them (apply to a new / existing project) — so this sheet is reusable
 * from both the new-estimate flow and a project screen. Selection only: rename / delete / editing
 * positions all live on the "Шаблони" page, not in this picker.
 *
 * <b>Several bundles at once.</b> A real job is rarely one bundle — a bathroom is «Санвузол» plus
 * «Підлога плиткою» — so rows are checkboxes and the footer applies the whole selection into ONE
 * estimate. Tapping the row toggles it (the whole row is the target, which is what works with a
 * thumb); the chevron on the right opens the preview instead. Duplicate positions across bundles
 * are dropped server-side and, offline, by the same rule locally.
 *
 * <b>And only the positions the master wants.</b> «деколи із великого шаблону треба 5-6 позицій і
 * це довго потім викидати» — so the preview is a CHECKLIST, not a read-only list, and the subset
 * it remembers rides the apply request. The preview's footer used to be a
 * «Обрати цей шаблон»/«Прибрати з вибору» toggle, which said nothing about the ticks just made;
 * it is «Готово» now, and the bundle's own tick follows the positions — untick every one of them
 * and the bundle drops out of the selection, because a bundle contributing nothing is not a thing
 * the master can mean. A bundle nobody drilled into keeps `itemIds: null` (all of it), so nothing
 * changes for the master who just wants the whole thing.
 *
 * <b>Trade is a LEVEL, and there are no chips.</b> The defaults used to sit behind a trade filter,
 * which is exactly the wrong control here: a chip answers «покажи мені тільки це», while this sheet
 * exists to compose ONE estimate — «з можливістю вибирати шаблони з різних трейдів для одного
 * кошторису». The selection always survived the filter, but with the other trades hidden the master
 * could not SEE it accumulating, so cross-trade picking read as impossible. The branches
 * ({@link toTemplateTree}) show every trade at once, each carrying a badge with how many of its
 * bundles are ticked, so a pick made in one trade stays visible while another is being browsed. A
 * single branch draws no trade header at all — the rule the chips already had, which is why a
 * one-trade master sees what he saw before. The search box stays: it is the control that actually
 * shortens a long list, and it opens every branch while it runs.
 */
export function TemplatePickerSheet({
  open,
  onClose,
  onPick,
  applying = false,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (picks: TemplatePick[]) => void;
  applying?: boolean;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const { data, isPending, isError } = useEstimateTemplates();
  const [preview, setPreview] = useState<EstimateTemplateSummary | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  // templateId → the positions ticked in it. A bundle absent from here is taken whole; the entry
  // outlives the preview closing and reopening, which is the «запамятати вибране» the master asked
  // for.
  const [subsets, setSubsets] = useState<Record<string, string[]>>({});
  const [query, setQuery] = useState('');
  // Which branches the master opened, keyed per SECTION and trade — the same trade legitimately
  // has both own bundles and defaults, and one shared key would open and close both together.
  const [openState, setOpenState] = useState<Record<string, boolean>>({});

  // Order matters — it decides which bundle's wording survives a duplicate, so the selection is
  // an array in tap order, not a Set.
  const toggle = (id: string) =>
    setPicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  /** The preview's «Готово»: the ticks decide both the subset and the bundle's own tick. */
  const applySubset = (templateId: string, itemIds: string[], total: number) => {
    setSubsets((s) => {
      const next = { ...s };
      // Everything ticked is not a subset — keeping one would freeze the bundle as it is today,
      // and a position added to it tomorrow would silently never arrive.
      if (itemIds.length === 0 || itemIds.length === total) delete next[templateId];
      else next[templateId] = itemIds;
      return next;
    });
    setPicked((ids) => {
      if (itemIds.length === 0) return ids.filter((x) => x !== templateId);
      return ids.includes(templateId) ? ids : [...ids, templateId];
    });
    setPreview(null);
  };

  const chosen = useMemo(
    () =>
      picked
        .map((id) => (data ?? []).find((t) => t.id === id))
        .filter((tpl): tpl is EstimateTemplateSummary => !!tpl)
        .map((tpl) => ({ template: tpl, itemIds: subsets[tpl.id] ?? null })),
    [picked, data, subsets],
  );

  // A master with one busy trade can have 20+ default bundles, which is a long scroll to find
  // «Паркан профнастил» — so the search box stays even though the chips went. It filters the LIST
  // only: a bundle already ticked stays ticked and still counts in the footer while it is filtered
  // out of view.
  const needle = query.trim().toLowerCase();
  const matches = (tpl: EstimateTemplateSummary) =>
    needle === '' || tpl.name.toLowerCase().includes(needle);
  const searching = needle !== '';

  const allDefaults = useMemo(() => (data ?? []).filter((t) => t.isDefault), [data]);

  const own = useMemo(
    () => (data ?? []).filter((t) => !t.isDefault && matches(t)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, needle],
  );
  const defaults = useMemo(
    () => allDefaults.filter(matches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allDefaults, needle],
  );
  const ownBranches = useMemo(() => toTemplateTree(own), [own]);
  const defaultBranches = useMemo(() => toTemplateTree(defaults), [defaults]);

  const isOpen = (key: string, fallback: boolean) => searching || (openState[key] ?? fallback);
  const toggleOpen = (key: string, fallback: boolean) =>
    setOpenState((prev) => ({ ...prev, [key]: !(prev[key] ?? fallback) }));

  const close = () => {
    setPreview(null);
    setPicked([]);
    setSubsets({});
    setQuery('');
    setOpenState({});
    onClose();
  };

  /** One section's worth of branches — «Мої шаблони» and «Готові шаблони» render identically. */
  const renderBranches = (scope: 'own' | 'default', branches: TemplateBranch[], total: number) => {
    // One branch = nothing for a trade level to disambiguate, so it is not drawn and its bundles
    // sit at the top of the section, exactly as they did before the tree.
    const showTrade = branches.length > 1;
    const autoOpen = !showTrade || total <= AUTO_EXPAND_MAX_TEMPLATES;
    return (
      <div className={showTrade ? 'space-y-2' : 'space-y-1.5'}>
        {branches.map((branch) => {
          const key = `${scope}:${branch.key}`;
          return (
            <TemplateBranchNode
              key={key}
              branch={branch}
              showTrade={showTrade}
              open={isOpen(key, autoOpen)}
              onToggle={searching ? undefined : () => toggleOpen(key, autoOpen)}
              picked={picked}
              subsets={subsets}
              onTogglePick={toggle}
              onOpen={setPreview}
            />
          );
        })}
      </div>
    );
  };

  return (
    <Modal open={open} onClose={close} title={preview ? preview.name : t('templates.pickTitle')}>
      {preview ? (
        <TemplatePreview
          template={preview}
          selected={picked.includes(preview.id)}
          pickedItemIds={subsets[preview.id] ?? null}
          applying={applying}
          onBack={() => setPreview(null)}
          onToggle={() => {
            toggle(preview.id);
            setPreview(null);
          }}
          onDone={(itemIds, total) => applySubset(preview.id, itemIds, total)}
        />
      ) : isPending ? (
        <div className="flex justify-center py-8 text-brand">
          <Spinner />
        </div>
      ) : !online && (data?.length ?? 0) === 0 ? (
        <OfflineNotCached compact what={t('offline.dataTemplates')} />
      ) : isError && !data ? (
        <p className="py-6 text-center text-sm text-muted">{t('templates.loadError')}</p>
      ) : (
        <div className="space-y-5">
          {/* Sticky so it survives the scroll it exists to shorten. */}
          {allDefaults.length > 8 && (
            <div className="sticky top-0 z-10 -mt-1 bg-surface pb-2 pt-1">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('templates.searchPlaceholder')}
                aria-label={t('templates.searchPlaceholder')}
                className="h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-sm text-primary placeholder:text-muted"
              />
            </div>
          )}

          {/* My templates */}
          <section>
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-brand">
              {t('templates.myTemplates')}
            </h3>
            {own.length === 0 ? (
              // «Ви ще не зберегли жодного шаблону» would be a lie while a search is filtering
              // them out — the master would think their templates were lost.
              <p className="rounded-xl border border-dashed border-border px-3 py-3 text-xs text-muted">
                {t(needle ? 'templates.nothingFound' : 'templates.emptyMy')}
              </p>
            ) : (
              renderBranches('own', ownBranches, own.length)
            )}
          </section>

          {/* Default templates, grouped by trade */}
          <section>
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-brand">
              {t('templates.defaultTemplates')}
            </h3>
            {defaultBranches.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-3 py-3 text-xs text-muted">
                {t(needle ? 'templates.nothingFound' : 'templates.emptyNone')}
              </p>
            ) : (
              renderBranches('default', defaultBranches, defaults.length)
            )}
          </section>

          {/* Sticky so the action stays reachable with a thumb however long the list runs. */}
          {chosen.length > 0 && (
            <div className="sticky bottom-0 -mx-1 bg-surface pt-2 pb-1">
              <Button fullWidth loading={applying} onClick={() => onPick(chosen)}>
                {t('templates.applyCount', { count: chosen.length })}
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/** One trade and its bundles. With a single branch the trade header is not drawn at all. */
function TemplateBranchNode({
  branch,
  showTrade,
  open,
  onToggle,
  picked,
  subsets,
  onTogglePick,
  onOpen,
}: {
  branch: TemplateBranch;
  showTrade: boolean;
  open: boolean;
  /** Absent while searching — every branch stays open, so a collapsed one cannot swallow a hit. */
  onToggle?: () => void;
  picked: readonly string[];
  subsets: Record<string, string[]>;
  onTogglePick: (id: string) => void;
  onOpen: (tpl: EstimateTemplateSummary) => void;
}) {
  const { t } = useTranslation();
  const custom = parseCustomTradeKey(branch.key) !== null;
  // A custom trade with no name left is still a real branch — it reads OTHER underneath (V91),
  // which is the honest label for it.
  const label = custom
    ? (branch.customName?.trim() ?? '') || t('trades.OTHER')
    : t('trades.' + branch.key);
  const pickedHere = branch.templates.filter((tpl) => picked.includes(tpl.id)).length;

  const rows = (
    <div
      className={cn(
        'space-y-1.5',
        // A thin rail, not an indent: at 375px every level of padding is width the bundle name
        // loses, and the name is the thing being read.
        showTrade && 'mt-1.5 border-l-2 border-brand-soft pl-2',
      )}
    >
      {branch.templates.map((tpl) => (
        <TemplateRow
          key={tpl.id}
          template={tpl}
          selected={picked.includes(tpl.id)}
          pickedCount={subsets[tpl.id]?.length ?? null}
          onToggle={() => onTogglePick(tpl.id)}
          onOpen={() => onOpen(tpl)}
        />
      ))}
    </div>
  );

  if (!showTrade) return rows;

  return (
    <section>
      <button
        type="button"
        data-testid="template-trade"
        onClick={onToggle}
        disabled={onToggle == null}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 rounded-xl bg-brand-soft px-3.5 py-2.5 text-left"
      >
        {onToggle && (
          <span
            aria-hidden
            className={cn('text-[10px] text-muted transition-transform', open && 'rotate-90')}
          >
            ▶
          </span>
        )}
        <span aria-hidden>{custom ? CUSTOM_TRADE_EMOJI : TRADE_EMOJI[branch.key as Trade]}</span>
        <span className="min-w-0 flex-1 break-words text-sm font-bold text-primary">{label}</span>
        {/* The point of the whole tree: a closed branch must still say it holds picks, or a
            selection spanning two trades looks like it was lost when the master browses on. */}
        {pickedHere > 0 && (
          <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-white">
            {pickedHere}
          </span>
        )}
        <span className="text-xs font-semibold text-muted">{branch.templates.length}</span>
      </button>
      {open && rows}
    </section>
  );
}

function TemplateRow({
  template,
  selected,
  pickedCount,
  onToggle,
  onOpen,
}: {
  template: EstimateTemplateSummary;
  selected: boolean;
  /** How many of its positions are ticked, when the master narrowed it; null = the whole bundle. */
  pickedCount: number | null;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const description = template.description?.trim() ?? '';
  return (
    <div
      className={`flex items-stretch rounded-xl border bg-surface ${
        selected ? 'border-brand' : 'border-border'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2.5 px-3.5 py-2.5 text-left"
      >
        <span
          aria-hidden
          className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border text-[11px] font-bold ${
            selected ? 'border-brand bg-brand text-white' : 'border-border text-transparent'
          }`}
        >
          ✓
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-medium text-primary">{template.name}</span>
          <span className="block text-xs text-muted">
            {pickedCount === null
              ? t('templates.itemsCount', { count: template.itemCount })
              : t('templates.pickedOfCount', { count: pickedCount, total: template.itemCount })}
          </span>
        </span>
      </button>
      {/* A finish level is a bundle (V121): what it promises the client is the half a master
          picking «Q3+» over «Q3» is actually choosing between. Beside the row — it is a button. */}
      {description !== '' && (
        <span className="flex flex-shrink-0 items-center pr-1">
          <InfoPopover label={template.name}>
            <span className="whitespace-pre-line">{description}</span>
          </InfoPopover>
        </span>
      )}
      <button
        type="button"
        onClick={onOpen}
        aria-label={t('templates.previewOf', { name: template.name })}
        className="flex min-h-[44px] w-11 flex-shrink-0 items-center justify-center border-l border-border text-muted"
      >
        ›
      </button>
    </div>
  );
}

/**
 * A bundle's composition — a CHECKLIST, not a read-only list. «деколи із великого шаблону треба
 * 5-6 позицій і це довго потім викидати», so the master narrows the bundle here and «Готово»
 * carries the ticks back; the parent remembers them for as long as the sheet is open.
 *
 * `ticked === null` is «the whole bundle», the same convention the parent stores — so a position
 * ADDED to the bundle later is included by a master who never narrowed it, and a remembered subset
 * that names a position since deleted simply doesn't match anything.
 */
function TemplatePreview({
  template,
  selected,
  pickedItemIds,
  applying,
  onBack,
  onToggle,
  onDone,
}: {
  template: EstimateTemplateSummary;
  selected: boolean;
  pickedItemIds: string[] | null;
  applying: boolean;
  onBack: () => void;
  onToggle: () => void;
  onDone: (itemIds: string[], total: number) => void;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const { data, isPending } = useEstimateTemplate(template.id);
  const items = useMemo(() => data?.items ?? [], [data]);
  const [ticked, setTicked] = useState<string[] | null>(pickedItemIds);
  const tickedIds = useMemo(
    () => (ticked === null ? items.map((it) => it.id) : items.filter((it) => ticked.includes(it.id)).map((it) => it.id)),
    [ticked, items],
  );
  const allTicked = tickedIds.length === items.length;

  const toggleItem = (id: string) =>
    setTicked((cur) => {
      const base = cur === null ? items.map((it) => it.id) : cur;
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    });

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 text-xs font-semibold text-brand">
        ← {t('common.back')}
      </button>
      {(template.description?.trim() ?? '') !== '' && (
        <div className="mb-3 rounded-xl bg-surface-sunken px-3 py-2.5">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-brand">
            {t('templates.promiseTitle')}
          </p>
          <p className="whitespace-pre-line text-xs leading-snug text-primary">
            {template.description?.trim()}
          </p>
          <p className="mt-1.5 text-[11px] text-muted">{t('templates.promiseHint')}</p>
        </div>
      )}
      <p className="mb-3 text-xs text-muted">{t('templates.pricesHint')}</p>
      {isPending ? (
        <div className="flex justify-center py-6 text-brand">
          <Spinner />
        </div>
      ) : !data ? (
        // No cached composition — showing an empty list here reads as "this template has no
        // positions", which is a lie about the master's own data. Offline that is fixable and we
        // say how; online it is a plain fetch failure.
        online ? (
          <p className="mb-5 py-4 text-center text-sm text-muted">{t('errors.unavailableText')}</p>
        ) : (
          <div className="mb-5">
            <OfflineNotCached compact what={t('offline.dataTemplateItems')} />
          </div>
        )
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-primary">
              {t('templates.pickedOfCount', { count: tickedIds.length, total: items.length })}
            </span>
            <button
              type="button"
              onClick={() => setTicked(allTicked ? [] : null)}
              className="min-h-[32px] px-1 text-xs font-semibold text-brand"
            >
              {t(allTicked ? 'templates.clearAll' : 'templates.selectAll')}
            </button>
          </div>
          <div className="mb-4 max-h-[40dvh] space-y-1 overflow-y-auto">
            {items.map((item) => {
              const on = tickedIds.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleItem(item.id)}
                  aria-pressed={on}
                  className={`flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ${
                    on ? 'bg-surface-sunken' : 'bg-surface-sunken opacity-50'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border text-[11px] font-bold ${
                      on ? 'border-brand bg-brand text-white' : 'border-border text-transparent'
                    }`}
                  >
                    ✓
                  </span>
                  <span className="min-w-0 flex-1 break-words text-primary">{item.name}</span>
                  <span className="flex-shrink-0 text-xs text-muted">{t('units.' + item.unit)}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
      {/* The preview only picks; applying is the sheet's footer, because the master may still
          want to add another bundle before creating the estimate. Without a composition to tick
          there is nothing to narrow, so the plain select/deselect toggle stays as the fallback. */}
      {data ? (
        <Button fullWidth loading={applying} onClick={() => onDone(tickedIds, items.length)}>
          {t('templates.done')}
        </Button>
      ) : (
        <Button fullWidth variant={selected ? 'secondary' : 'primary'} loading={applying} onClick={onToggle}>
          {t(selected ? 'templates.deselect' : 'templates.select')}
        </Button>
      )}
    </div>
  );
}
