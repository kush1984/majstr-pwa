import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Chip } from '@/components/Chip.tsx';
import { Input } from '@/components/Input.tsx';
import { Select } from '@/components/Select.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { OfflineNotCached } from '@/components/OfflineNotCached.tsx';
import { useOnline } from '@/lib/useOnline.ts';
import { ErrorState } from '@/components/ErrorState.tsx';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { cn } from '@/lib/cn.ts';
import { formatMoney } from '@/lib/format.ts';
import { TRADE_EMOJI, CUSTOM_TRADE_EMOJI } from '@/lib/labels.ts';
import { ITEM_TYPE_OPTIONS, UNIT_OPTIONS } from '@/features/catalog/catalogItemSchema.ts';
import { useMe } from '@/features/auth/useMe.ts';
import { useCatalog } from '@/features/catalog/useCatalog.ts';
import {
  TradeFilterChips,
  tradeMatches,
  customTradeKey,
  type TradeKey,
} from '@/features/catalog/TradeFilterChips.tsx';
import {
  SaveToCatalogPrompt,
  type CatalogSaveDraft,
} from '@/features/catalog/SaveToCatalogPrompt.tsx';
import type { EstimateTemplateSummary, ItemType, Trade, Unit } from '@/api/types.ts';
import { TradeSelect } from './TradeSelect.tsx';
import {
  useAddTemplateItem,
  useDeleteTemplate,
  useEstimateTemplate,
  useEstimateTemplates,
  useRemoveTemplateItem,
  useRenameTemplate,
  useSetTemplateTrade,
} from './useEstimateTemplates.ts';

/**
 * Standalone home for estimate templates ("Мої шаблони" in the nav). Lists the
 * master's own saved templates and the system defaults grouped by trade.
 * Tapping a row OPENS a read-only composition view (both own and default); the
 * pencil opens the full editor (rename + add/remove positions) — own only. To
 * create an estimate from one, the master uses "New estimate → from template".
 */
export function TemplatesPage() {
  const { t } = useTranslation();
  const { data, isPending, isError, error, refetch } = useEstimateTemplates();
  const deleteTemplate = useDeleteTemplate();

  const [preview, setPreview] = useState<EstimateTemplateSummary | null>(null);
  const [editing, setEditing] = useState<EstimateTemplateSummary | null>(null);
  const [deleting, setDeleting] = useState<EstimateTemplateSummary | null>(null);

  // Trade filter chips over the whole list — same pattern as the catalog, but templates use
  // GENERAL (not OTHER) for "no specific trade", so this stays its own small implementation
  // rather than the shared TradeFilterChips (which hardcodes the catalog's OTHER semantics).
  // Built from the trades actually present, so it never shows an empty filter.
  const [tradeFilter, setTradeFilter] = useState<Set<TradeKey>>(new Set());
  // useCallback, not a plain arrow: the two memos below filter with it, and a fresh
  // function each render would either be a lying dependency list or defeat the memo.
  // A custom trade is own-templates-only (a default can never carry one — the DB CHECK
  // pins is_default=false alongside it), so passing it through here is always safe.
  const matchTrade = useCallback(
    (trade: string | null, customTradeId?: string | null) => {
      if (tradeFilter.size === 0) return true;
      if (customTradeId) return tradeFilter.has(customTradeKey(customTradeId));
      return tradeFilter.has((trade ?? 'GENERAL') as TradeKey);
    },
    [tradeFilter],
  );

  const presentTrades = useMemo(() => {
    const system = new Set<Trade>();
    const customs = new Map<string, string>();
    for (const tpl of data ?? []) {
      if (tpl.customTradeId) customs.set(tpl.customTradeId, tpl.customTradeName ?? '');
      else system.add(tpl.trade ?? 'GENERAL');
    }
    return { system: [...system], customs: [...customs.entries()] };
  }, [data]);
  const totalPresentTrades = presentTrades.system.length + presentTrades.customs.length;
  const toggleTemplateTrade = (key: TradeKey) =>
    setTradeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next.size >= totalPresentTrades ? new Set() : next;
    });

  const own = useMemo(
    () => (data ?? []).filter((x) => !x.isDefault && matchTrade(x.trade, x.customTradeId)),
    [data, matchTrade],
  );
  const defaultsByTrade = useMemo(() => {
    const groups = new Map<string, EstimateTemplateSummary[]>();
    for (const tpl of (data ?? []).filter((x) => x.isDefault && matchTrade(x.trade))) {
      const key = tpl.trade ?? 'GENERAL';
      const bucket = groups.get(key);
      if (bucket) bucket.push(tpl);
      else groups.set(key, [tpl]);
    }
    return [...groups.entries()];
  }, [data, matchTrade]);
  const hasOwnTemplates = (data ?? []).some((x) => !x.isDefault);

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteTemplate.mutateAsync(deleting.id);
      toast.success(t('templates.deleted'));
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <>
      <h1 className="mb-4 text-2xl font-extrabold tracking-tight text-primary sm:text-[26px]">
        {t('templates.myTemplates')}
      </h1>

      {isPending ? (
        <div className="flex justify-center py-10 text-brand">
          <Spinner />
        </div>
      ) : isError && !data ? (
        <ErrorState
          error={error}
          title={t('templates.loadError')}
          what={t('offline.dataTemplates')}
          onRetry={() => void refetch()}
        />
      ) : (
        <div className="space-y-6">
          {totalPresentTrades >= 2 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              <Chip active={tradeFilter.size === 0} onClick={() => setTradeFilter(new Set())}>
                {t('catalog.allTrades')}
              </Chip>
              {presentTrades.system.map((tr) => (
                <Chip key={tr} active={tradeFilter.has(tr)} onClick={() => toggleTemplateTrade(tr)}>
                  {TRADE_EMOJI[tr]} {t('trades.' + tr)}
                </Chip>
              ))}
              {presentTrades.customs.map(([id, name]) => (
                <Chip
                  key={id}
                  active={tradeFilter.has(customTradeKey(id))}
                  onClick={() => toggleTemplateTrade(customTradeKey(id))}
                >
                  {CUSTOM_TRADE_EMOJI} {name}
                </Chip>
              ))}
            </div>
          )}
          {/* My templates */}
          <section>
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-brand">
              {t('templates.myTemplates')}
            </h2>
            {!hasOwnTemplates ? (
              <EmptyState icon="📋" title={t('templates.myTemplates')} text={t('templates.emptyMy')} />
            ) : (
              <div className="space-y-1.5">
                {own.map((tpl) => (
                  <Row
                    key={tpl.id}
                    template={tpl}
                    onOpen={() => setPreview(tpl)}
                    onEdit={() => setEditing(tpl)}
                    onDelete={() => setDeleting(tpl)}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Default templates (read-only) */}
          <section>
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-brand">
              {t('templates.defaultTemplates')}
            </h2>
            <div className="space-y-4">
              {defaultsByTrade.map(([trade, items]) => (
                <div key={trade}>
                  <div className="mb-1.5 text-xs font-semibold text-muted">
                    {TRADE_EMOJI[trade as keyof typeof TRADE_EMOJI] ?? '📦'} {t('trades.' + trade)}
                  </div>
                  <div className="space-y-1.5">
                    {items.map((tpl) => (
                      <Row key={tpl.id} template={tpl} onOpen={() => setPreview(tpl)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.name ?? t('templates.viewTitle')}
      >
        {preview && (
          <>
            {/* Re-file into any trade — the master's own setting, for own AND system templates. */}
            <div className="mb-3">
              <TradeMove template={preview} onMoved={(next) => setPreview(next)} />
            </div>
            <Preview templateId={preview.id} />
          </>
        )}
      </Modal>

      {editing && <EditModal template={editing} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={Boolean(deleting)}
        title={t('templates.deleteTitle')}
        message={t('templates.deleteMessage', { name: deleting?.name ?? '' })}
        loading={deleteTemplate.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}

function Row({
  template,
  onOpen,
  onEdit,
  onDelete,
}: {
  template: EstimateTemplateSummary;
  onOpen: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-3">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block break-words text-sm font-medium text-primary">{template.name}</span>
        <span className="block text-xs text-muted">
          {t('templates.itemsCount', { count: template.itemCount })}
        </span>
      </button>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={t('templates.edit')}
          className="flex-shrink-0 px-1 text-base text-muted"
        >
          ✏️
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={t('common.delete')}
          className="flex-shrink-0 px-1 text-base text-muted"
        >
          🗑
        </button>
      )}
    </div>
  );
}

/** Re-file a template into a trade — an instant save on change, per-master. */
function TradeMove({
  template,
  onMoved,
}: {
  template: EstimateTemplateSummary;
  onMoved: (next: EstimateTemplateSummary) => void;
}) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const setTrade = useSetTemplateTrade();
  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <TradeSelect
          value={{ trade: template.trade ?? null, customTradeId: template.customTradeId }}
          label={t('templates.tradeLabel')}
          // A system default is re-filed through the per-master override, which has no
          // place for a custom trade — offer the picker only on the master's own template.
          customTrades={template.isDefault ? [] : (me?.customTrades ?? [])}
          onChange={(next) => {
            const customTradeName = next.customTradeId
              ? (me?.customTrades ?? []).find((ct) => ct.id === next.customTradeId)?.name ?? null
              : null;
            setTrade.mutate(
              { id: template.id, trade: next.trade, customTradeId: next.customTradeId, customTradeName },
              {
                onSuccess: () => {
                  onMoved({
                    ...template,
                    trade: next.customTradeId ? 'OTHER' : next.trade,
                    customTradeId: next.customTradeId,
                    customTradeName,
                  });
                  toast.success(t('templates.tradeMoved'));
                },
                onError: (err) => toast.error(toAppError(err).message),
              },
            );
          }}
        />
      </div>
      {setTrade.isPending && <Spinner size="sm" />}
    </div>
  );
}

/** Read-only composition — what a row tap shows (own and default alike). */
function Preview({ templateId }: { templateId: string }) {
  const { t } = useTranslation();
  const online = useOnline();
  const { data, isPending } = useEstimateTemplate(templateId);

  if (isPending) {
    return (
      <div className="flex justify-center py-6 text-brand">
        <Spinner />
      </div>
    );
  }
  // NO data (never cached, and we're offline / the request failed) is NOT "this template is empty" —
  // saying so would be a lie about the master's own template. Be honest about what happened, and
  // offline that means saying how to fix it.
  if (!data && !online) return <OfflineNotCached compact what={t('offline.dataTemplateItems')} />;
  if (!data) {
    return <p className="py-3 text-center text-xs text-muted">{t('errors.unavailableText')}</p>;
  }

  const items = data.items ?? [];
  if (items.length === 0) {
    return <p className="py-3 text-center text-xs text-muted">{t('templates.emptyComposition')}</p>;
  }
  return (
    <div className="max-h-[60dvh] space-y-1 overflow-y-auto">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center justify-between gap-2 rounded-lg bg-surface-sunken px-3 py-2 text-sm"
        >
          <span className="min-w-0 break-words text-primary">{item.name}</span>
          <span className="flex-shrink-0 text-xs text-muted">{t('units.' + item.unit)}</span>
        </div>
      ))}
    </div>
  );
}

type AddTab = 'catalog' | 'manual';

/** Full editor for an OWN template: rename + add/remove positions. */
function EditModal({
  template,
  onClose,
}: {
  template: EstimateTemplateSummary;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const { data, isPending } = useEstimateTemplate(template.id);
  const rename = useRenameTemplate();
  const removeItem = useRemoveTemplateItem(template.id);
  const [name, setName] = useState(template.name);
  const [tab, setTab] = useState<AddTab>('catalog');
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  const items = data?.items ?? [];
  const trimmed = name.trim();
  const canSaveName = trimmed.length > 0 && trimmed !== template.name;

  const saveName = async () => {
    if (!canSaveName) return;
    try {
      await rename.mutateAsync({ id: template.id, name: trimmed });
      toast.success(t('templates.renamed'));
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };
  const onRemove = async (itemId: string) => {
    try {
      await removeItem.mutateAsync(itemId);
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  return (
    <Modal open onClose={onClose} title={t('templates.editTitle')} size="lg">
      {/* Name */}
      <div className="mb-3 flex items-stretch gap-2">
        <Input
          value={name}
          maxLength={255}
          onChange={(e) => setName(e.target.value)}
          className="flex-1"
        />
        <Button onClick={saveName} loading={rename.isPending} disabled={!canSaveName}>
          {t('common.save')}
        </Button>
      </div>

      {/* Composition */}
      <div className="mb-3 max-h-[32dvh] space-y-1 overflow-y-auto">
        {isPending ? (
          <div className="flex justify-center py-4 text-brand">
            <Spinner />
          </div>
        ) : !data ? (
          // No cached detail — don't claim the template is empty.
          online ? (
            <p className="py-3 text-center text-xs text-muted">{t('errors.unavailableText')}</p>
          ) : (
            <OfflineNotCached compact what={t('offline.dataTemplateItems')} />
          )
        ) : items.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted">{t('templates.emptyComposition')}</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-surface-sunken px-3 py-2 text-sm"
            >
              <span className="min-w-0 break-words text-primary">{item.name}</span>
              <span className="flex flex-shrink-0 items-center gap-2">
                <span className="text-xs text-muted">{t('units.' + item.unit)}</span>
                <button
                  type="button"
                  onClick={() => setRemoving({ id: item.id, name: item.name })}
                  aria-label={t('common.delete')}
                  className="text-base text-muted"
                >
                  🗑
                </button>
              </span>
            </div>
          ))
        )}
      </div>

      {/* Add position — catalog (browse) or manual */}
      <div className="rounded-xl border border-border p-3">
        <div className="mb-3 flex gap-1 rounded-xl bg-surface-sunken p-1">
          {(['catalog', 'manual'] as AddTab[]).map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              onClick={() => setTab(tabKey)}
              className={cn(
                'flex-1 rounded-lg py-2 text-sm font-semibold transition-colors',
                tab === tabKey ? 'bg-surface text-primary shadow-card' : 'text-muted',
              )}
            >
              {tabKey === 'catalog' ? t('templates.addFromCatalog') : t('templates.addManual')}
            </button>
          ))}
        </div>
        {tab === 'catalog' ? (
          <CatalogPicker
            templateId={template.id}
            existingNames={items.map((i) => i.name)}
          />
        ) : (
          <ManualAdd templateId={template.id} />
        )}
      </div>

      <ConfirmDialog
        open={removing !== null}
        title={t('templates.removeItemTitle')}
        message={t('templates.removeItemConfirm', { name: removing?.name ?? '' })}
        confirmLabel={t('common.delete')}
        loading={removeItem.isPending}
        onConfirm={async () => {
          if (removing) {
            await onRemove(removing.id);
            setRemoving(null);
          }
        }}
        onClose={() => setRemoving(null)}
      />
    </Modal>
  );
}

/**
 * Browse the catalog, filter by trade (2+ trades) + name, multi-select positions,
 * then add them to the template (name+type+unit only — no quantity/price; those
 * are resolved when the template is applied). Positions already in the template
 * are shown disabled so they aren't added twice.
 */
function CatalogPicker({
  templateId,
  existingNames,
}: {
  templateId: string;
  existingNames: string[];
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const { data, isPending } = useCatalog();
  const addItem = useAddTemplateItem(templateId);
  const [q, setQ] = useState('');
  const [tradeFilter, setTradeFilter] = useState<Set<TradeKey>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const present = useMemo(
    () => new Set(existingNames.map((n) => n.trim().toLowerCase())),
    [existingNames],
  );
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? [])
      .filter((i) => tradeMatches(i, tradeFilter))
      .filter((i) => !needle || i.name.toLowerCase().includes(needle));
  }, [data, q, tradeFilter]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const add = async () => {
    if (selected.size === 0) return;
    const picks = (data ?? []).filter((i) => selected.has(i.id));
    setAdding(true);
    try {
      // No batch endpoint for template items — append one by one (server assigns
      // the next sort order each time). Sequential so order is stable.
      for (const item of picks) {
        await addItem.mutateAsync({ name: item.name, type: item.type, unit: item.unit });
      }
      toast.success(t('estimate.itemsAdded', { count: picks.length }));
      setSelected(new Set());
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div>
      <TradeFilterChips items={data ?? []} value={tradeFilter} onChange={setTradeFilter} />
      <Input
        placeholder={t('estimate.searchCatalog')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="mb-3"
      />
      <div className="max-h-[30dvh] space-y-1.5 overflow-y-auto">
        {isPending ? (
          <p className="py-6 text-center text-sm text-muted">{t('common.loading')}</p>
        ) : !online && (data?.length ?? 0) === 0 ? (
          // Not "нічого не знайдено" — the catalog simply never reached the device.
          <OfflineNotCached compact what={t('offline.dataCatalog')} />
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">{t('estimate.catalogEmptyResult')}</p>
        ) : (
          filtered.map((item) => {
            const already = present.has(item.name.trim().toLowerCase());
            const checked = selected.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                data-testid="catalog-row"
                disabled={already}
                onClick={() => toggle(item.id)}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors',
                  already
                    ? 'cursor-not-allowed border-border bg-surface-sunken opacity-50'
                    : checked
                      ? 'border-brand bg-brand-soft'
                      : 'border-border bg-surface',
                )}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={cn(
                      'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border text-xs',
                      checked ? 'border-brand bg-brand text-white' : 'border-border text-transparent',
                    )}
                  >
                    ✓
                  </span>
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-medium text-primary">
                      {item.name}
                    </span>
                    <span className="block text-xs text-muted">
                      {t('unitPer', { unit: t('units.' + item.unit) })}
                    </span>
                  </span>
                </span>
                <span className="whitespace-nowrap text-sm font-semibold text-primary">
                  {formatMoney(item.defaultPrice)}
                </span>
              </button>
            );
          })
        )}
      </div>

      {selected.size > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <Button fullWidth loading={adding} onClick={add}>
            {t('estimate.addNItems', { count: selected.size })}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Type a one-off position (name + type + unit) the catalog doesn't have. */
function ManualAdd({ templateId }: { templateId: string }) {
  const { t } = useTranslation();
  const addItem = useAddTemplateItem(templateId);
  const [name, setName] = useState('');
  const [type, setType] = useState<ItemType>('WORK');
  const [unit, setUnit] = useState<Unit>('M2');
  // After a position is added to the template, offer to also save it to the
  // master's catalog (with a category/trade/price) so applying the template
  // substitutes its price later.
  const [savePrompt, setSavePrompt] = useState<CatalogSaveDraft | null>(null);

  const onAdd = async () => {
    if (!name.trim()) return;
    try {
      await addItem.mutateAsync({ name: name.trim(), type, unit });
      setSavePrompt({ name: name.trim(), type, unit });
      setName('');
      setType('WORK');
      setUnit('M2');
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  if (savePrompt) {
    return <SaveToCatalogPrompt item={savePrompt} onClose={() => setSavePrompt(null)} />;
  }

  return (
    <div className="space-y-2">
      <Input
        value={name}
        maxLength={255}
        placeholder={t('templates.addItemName')}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="grid grid-cols-2 gap-2">
        <Select value={type} onChange={(e) => setType(e.target.value as ItemType)}>
          {ITEM_TYPE_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {t('itemType.' + v)}
            </option>
          ))}
        </Select>
        <Select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
          {UNIT_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {t('unitOptions.' + v)}
            </option>
          ))}
        </Select>
      </div>
      <Button fullWidth loading={addItem.isPending} onClick={onAdd}>
        {t('templates.addItem')}
      </Button>
    </div>
  );
}
