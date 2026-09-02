import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { InfoPopover } from '@/components/InfoPopover.tsx';
import { OfflineNotCached } from '@/components/OfflineNotCached.tsx';
import { useOnline } from '@/lib/useOnline.ts';
import { TRADE_EMOJI } from '@/lib/labels.ts';
import type { EstimateTemplateSummary } from '@/api/types.ts';
import { useEstimateTemplate, useEstimateTemplates } from './useEstimateTemplates.ts';

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
  const [trade, setTrade] = useState<string | null>(null);

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
  // «Паркан профнастил». The trade chips only help when there IS more than one trade, so the
  // search box is the part that carries this; both filter the LIST only — a bundle already ticked
  // stays ticked and still counts in the footer while it is filtered out of view.
  const needle = query.trim().toLowerCase();
  const matches = (tpl: EstimateTemplateSummary) =>
    needle === '' || tpl.name.toLowerCase().includes(needle);

  const allDefaults = useMemo(() => (data ?? []).filter((t) => t.isDefault), [data]);
  const trades = useMemo(
    () => [...new Set(allDefaults.map((t) => t.trade ?? 'GENERAL'))],
    [allDefaults],
  );

  const own = useMemo(
    () => (data ?? []).filter((t) => !t.isDefault && matches(t)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, needle],
  );
  const defaultsByTrade = useMemo(() => {
    const groups = new Map<string, EstimateTemplateSummary[]>();
    for (const tpl of allDefaults) {
      const key = tpl.trade ?? 'GENERAL';
      if (!matches(tpl) || (trade !== null && key !== trade)) continue;
      const bucket = groups.get(key);
      if (bucket) bucket.push(tpl);
      else groups.set(key, [tpl]);
    }
    return [...groups.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDefaults, needle, trade]);

  const close = () => {
    setPreview(null);
    setPicked([]);
    setSubsets({});
    setQuery('');
    setTrade(null);
    onClose();
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
            <div className="sticky top-0 z-10 -mt-1 space-y-2 bg-surface pb-2 pt-1">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('templates.searchPlaceholder')}
                aria-label={t('templates.searchPlaceholder')}
                className="h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-sm text-primary placeholder:text-muted"
              />
              {trades.length > 1 && (
                <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
                  <TradeChip active={trade === null} onClick={() => setTrade(null)}>
                    {t('templates.filterAll')}
                  </TradeChip>
                  {trades.map((code) => (
                    <TradeChip
                      key={code}
                      active={trade === code}
                      onClick={() => setTrade(trade === code ? null : code)}
                    >
                      {TRADE_EMOJI[code] ?? '📦'} {t('trades.' + code)}
                    </TradeChip>
                  ))}
                </div>
              )}
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
              <div className="space-y-1.5">
                {own.map((tpl) => (
                  <TemplateRow
                    key={tpl.id}
                    template={tpl}
                    selected={picked.includes(tpl.id)}
                    pickedCount={subsets[tpl.id]?.length ?? null}
                    onToggle={() => toggle(tpl.id)}
                    onOpen={() => setPreview(tpl)}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Default templates, grouped by trade */}
          <section>
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-brand">
              {t('templates.defaultTemplates')}
            </h3>
            {defaultsByTrade.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-3 py-3 text-xs text-muted">
                {t(needle || trade !== null ? 'templates.nothingFound' : 'templates.emptyNone')}
              </p>
            ) : (
              <div className="space-y-4">
                {defaultsByTrade.map(([trade, items]) => (
                  <div key={trade}>
                    <div className="mb-1.5 text-xs font-semibold text-muted">
                      {TRADE_EMOJI[trade as keyof typeof TRADE_EMOJI] ?? '📦'} {t('trades.' + trade)}
                    </div>
                    <div className="space-y-1.5">
                      {items.map((tpl) => (
                        <TemplateRow
                          key={tpl.id}
                          template={tpl}
                          selected={picked.includes(tpl.id)}
                          pickedCount={subsets[tpl.id]?.length ?? null}
                          onToggle={() => toggle(tpl.id)}
                          onOpen={() => setPreview(tpl)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
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

function TradeChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      // h-11, matching the search box: 44 px is the thumb minimum, and a filter row is exactly the
      // kind of secondary control that quietly ends up at 32 px and unusable one-handed.
      className={`h-11 flex-shrink-0 whitespace-nowrap rounded-full border px-3.5 text-xs font-semibold ${
        active ? 'border-brand bg-brand-soft text-brand' : 'border-border bg-surface text-muted'
      }`}
    >
      {children}
    </button>
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
