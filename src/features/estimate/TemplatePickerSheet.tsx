import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { OfflineNotCached } from '@/components/OfflineNotCached.tsx';
import { useOnline } from '@/lib/useOnline.ts';
import { TRADE_EMOJI } from '@/lib/labels.ts';
import type { EstimateTemplateSummary } from '@/api/types.ts';
import { useEstimateTemplate, useEstimateTemplates } from './useEstimateTemplates.ts';

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
 */
export function TemplatePickerSheet({
  open,
  onClose,
  onPick,
  applying = false,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (templates: EstimateTemplateSummary[]) => void;
  applying?: boolean;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const { data, isPending, isError } = useEstimateTemplates();
  const [preview, setPreview] = useState<EstimateTemplateSummary | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [trade, setTrade] = useState<string | null>(null);

  // Order matters — it decides which bundle's wording survives a duplicate, so the selection is
  // an array in tap order, not a Set.
  const toggle = (id: string) =>
    setPicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const chosen = useMemo(
    () => picked.map((id) => (data ?? []).find((t) => t.id === id)).filter(Boolean) as EstimateTemplateSummary[],
    [picked, data],
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
          applying={applying}
          onBack={() => setPreview(null)}
          onToggle={() => {
            toggle(preview.id);
            setPreview(null);
          }}
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
  onToggle,
  onOpen,
}: {
  template: EstimateTemplateSummary;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
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
            {t('templates.itemsCount', { count: template.itemCount })}
          </span>
        </span>
      </button>
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

function TemplatePreview({
  template,
  selected,
  applying,
  onBack,
  onToggle,
}: {
  template: EstimateTemplateSummary;
  selected: boolean;
  applying: boolean;
  onBack: () => void;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const { data, isPending } = useEstimateTemplate(template.id);

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 text-xs font-semibold text-brand">
        ← {t('common.back')}
      </button>
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
        <div className="mb-5 max-h-[40dvh] space-y-1 overflow-y-auto">
          {(data.items ?? []).map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 rounded-lg bg-surface-sunken px-3 py-2 text-sm"
            >
              <span className="min-w-0 break-words text-primary">{item.name}</span>
              <span className="flex-shrink-0 text-xs text-muted">{t('units.' + item.unit)}</span>
            </div>
          ))}
        </div>
      )}
      {/* The preview only picks; applying is the sheet's footer, because the master may still
          want to add another bundle before creating the estimate. */}
      <Button fullWidth variant={selected ? 'secondary' : 'primary'} loading={applying} onClick={onToggle}>
        {t(selected ? 'templates.deselect' : 'templates.select')}
      </Button>
    </div>
  );
}
