import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { Chip } from '@/components/Chip.tsx';
import { DragGrip } from '@/components/DragGrip.tsx';
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
import { newUuid } from '@/lib/uuid.ts';
import { scrollRowIntoView } from '@/lib/scrollRowIntoView.ts';
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
import type {
  EstimateTemplateDetail,
  EstimateTemplateItemView,
  EstimateTemplateSummary,
  ItemType,
  TemplateItemRequest,
  Trade,
  Unit,
} from '@/api/types.ts';
import { TradeSelect } from './TradeSelect.tsx';
import {
  useAddTemplateItem,
  useDeleteTemplate,
  useEstimateTemplate,
  useEstimateTemplates,
  useRemoveTemplateItem,
  useRenameTemplate,
  useReorderTemplateItems,
  useRestoreDefaults,
  useSetTemplateTrade,
  useUpdateTemplateItem,
} from './useEstimateTemplates.ts';

/**
 * Standalone home for estimate templates ("Мої шаблони" in the nav). Lists the
 * master's own saved templates and the system defaults grouped by trade.
 * Tapping a row OPENS a read-only composition view; the pencil opens the full
 * editor (rename + add / edit / remove / rearrange positions). To create an
 * estimate from one, the master uses "New estimate → from template".
 *
 * **Every template is editable here, defaults included.** A default is a row shared by every
 * master, so the server forks it into this master's own copy on the first write and hides the
 * original for them alone (deleting one is just that hide). Which means a write can answer with a
 * DIFFERENT template id than it was given — the editor follows it, see {@link EditModal}.
 */
export function TemplatesPage() {
  const { t } = useTranslation();
  const { data, isPending, isError, error, refetch } = useEstimateTemplates();
  const deleteTemplate = useDeleteTemplate();
  const restoreDefaults = useRestoreDefaults();

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
      toast.success(deleting.isDefault ? t('templates.defaultHidden') : t('templates.deleted'));
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setDeleting(null);
    }
  };

  const onRestoreDefaults = async () => {
    try {
      await restoreDefaults.mutateAsync();
      toast.success(t('templates.defaultsRestored'));
    } catch (err) {
      toast.error(toAppError(err).message);
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

          {/* Ready-made templates — editable too: the first write forks one into the master's own. */}
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
                      <Row
                        key={tpl.id}
                        template={tpl}
                        onOpen={() => setPreview(tpl)}
                        onEdit={() => setEditing(tpl)}
                        onDelete={() => setDeleting(tpl)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {/* Always offered: which defaults are hidden is not something the device can know
                (the list simply omits them), so there is nothing to condition this on. */}
            <button
              type="button"
              onClick={() => void onRestoreDefaults()}
              disabled={restoreDefaults.isPending}
              className="mt-3 py-2 text-xs font-semibold text-brand underline disabled:opacity-50"
            >
              {t('templates.restoreDefaults')}
            </button>
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
        title={deleting?.isDefault ? t('templates.hideDefaultTitle') : t('templates.deleteTitle')}
        message={
          deleting?.isDefault
            ? t('templates.hideDefaultMessage', { name: deleting?.name ?? '' })
            : t('templates.deleteMessage', { name: deleting?.name ?? '' })
        }
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
  // Numbered, because the order is the sequence the works are done in — not decoration.
  return (
    <div className="max-h-[60dvh] space-y-1 overflow-y-auto">
      {items.map((item, index) => (
        <div
          key={item.id}
          className="flex items-center justify-between gap-2 rounded-lg bg-surface-sunken px-3 py-2 text-sm"
        >
          <span className="min-w-0 break-words text-primary">
            <span className="mr-1.5 text-xs font-semibold text-faint">{index + 1}.</span>
            {item.name}
          </span>
          <span className="flex-shrink-0 text-xs text-muted">{t('units.' + item.unit)}</span>
        </div>
      ))}
    </div>
  );
}

type AddTab = 'catalog' | 'manual';

/** One position while it is being edited. `isNew` marks a draft-only row that has no server id yet. */
type DraftItem = EstimateTemplateItemView & { isNew?: boolean };
/** The whole editable state of a template: its name and its sequence of positions. */
type Draft = { name: string; items: DraftItem[] };

const toDraft = (d: EstimateTemplateDetail): Draft => ({ name: d.name, items: d.items ?? [] });
const reqOf = (i: DraftItem): TemplateItemRequest => ({ name: i.name, type: i.type, unit: i.unit });
const sameItem = (a: DraftItem, b: DraftItem) =>
  a.name === b.name && a.type === b.type && a.unit === b.unit;
/** Order included on purpose — a bundle is a sequence, so a drag alone is a real change. */
const sameItems = (a: DraftItem[], b: DraftItem[]) =>
  a.length === b.length && a.every((x, i) => x.id === b[i].id && sameItem(x, b[i]));

/**
 * Full editor for a template: rename, add / edit / remove positions, and drag them into the order
 * they are actually done in.
 *
 * Three things drive the shape here.
 *
 * **Nothing is written until «Зберегти».** The editor works on a local draft and the button lights
 * up on ANY change — name, add, edit, remove, drag — while closing a dirty draft asks save /
 * discard / cancel. It used to write every action the moment it happened; the master asked for the
 * opposite, because a bundle is composed in one sitting and half of that composing is trying things
 * out. So the draft is the editor's truth and the save is one deliberate act.
 *
 * **Order is content.** A bundle is a SEQUENCE — what is done after what — not a bag of positions,
 * so a position carries its number and a drag is a real change, not decoration.
 *
 * **A ready-made template forks on the first write.** The server answers every write with the
 * template it actually wrote, so `activeId` follows that id: keep pointing at the default and the
 * next refetch would hand back the pristine bundle, making the edits look like they vanished.
 * Later writes in the same save may still address the id we started from — the server resolves the
 * default to the same copy — so the sequence never has to wait for a re-render.
 */
function EditModal({
  template,
  onClose,
}: {
  template: EstimateTemplateSummary;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const [activeId, setActiveId] = useState(template.id);
  const { data, isPending } = useEstimateTemplate(activeId);
  const rename = useRenameTemplate();
  const addItem = useAddTemplateItem(activeId);
  const updateItem = useUpdateTemplateItem(activeId);
  const removeItem = useRemoveTemplateItem(activeId);
  const reorder = useReorderTemplateItems(activeId);

  // The draft IS the editor. Seeded from the composition once it arrives; the name is editable from
  // the first frame because the summary always carries it, even offline with no cached detail.
  const [draft, setDraft] = useState<Draft>({ name: template.name, items: [] });
  const [baseline, setBaseline] = useState<Draft>({ name: template.name, items: [] });
  const [seeded, setSeeded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<AddTab>('catalog');
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [editingItem, setEditingItem] = useState<DraftItem | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  // A bundle runs past what the list shows, and a position is appended at the BOTTOM — out of sight
  // exactly when the master wants to check it landed. Set on every add/edit, consumed by the effect
  // below once the row it names actually exists.
  const scrollTo = useRef<string | null>(null);

  useEffect(() => {
    if (seeded || !data) return;
    const loaded = toDraft(data);
    // The name is editable from the first frame, so it can already have been typed into before the
    // composition arrived — seeding must not throw that away. Same for a position added meanwhile:
    // only a draft-only row can exist pre-seed, everything else IS what just loaded.
    setDraft((d) => ({
      name: d.name === baseline.name ? loaded.name : d.name,
      items: [...loaded.items, ...d.items.filter((i) => i.isNew)],
    }));
    setBaseline(loaded);
    setSeeded(true);
  }, [data, seeded, baseline.name]);

  const items = draft.items;
  const trimmed = draft.name.trim();
  const dirty = trimmed !== baseline.name || !sameItems(items, baseline.items);
  /**
   * Rows that differ from what is on the server — added this session, or edited and not yet written.
   * Derived, not tracked: with an explicit save the highlight means «ще не збережено», so it lights
   * up on the change and goes out on «Зберегти» with nothing to remember or clear. (The estimate
   * board has to keep a touched-set instead, because there every action writes immediately.)
   */
  const unsaved = useMemo(() => {
    const was = new Map(baseline.items.map((i) => [i.id, i]));
    return new Set(items.filter((i) => {
      const before = was.get(i.id);
      return !before || !sameItem(before, i);
    }).map((i) => i.id));
  }, [items, baseline.items]);
  const canSave = dirty && trimmed.length > 0;
  const stillDefault = activeId === template.id && template.isDefault;

  /** Re-point at the copy the server just made out of a ready-made bundle. */
  const follow = (next: { id: string } | undefined) => {
    if (next && next.id !== activeId) {
      setActiveId(next.id);
      toast.info(t('templates.forked'));
    }
  };

  const onAdd = (req: TemplateItemRequest): Promise<void> => {
    const id = newUuid();
    setDraft((d) => ({
      ...d,
      items: [...d.items, { ...req, id, sortOrder: d.items.length, isNew: true }],
    }));
    // Picking several from the catalog calls this once per position; the last one wins, so the list
    // lands on the END of the batch — which is where you look to check the whole lot arrived.
    scrollTo.current = id;
    return Promise.resolve();
  };
  const onUpdate = (itemId: string, req: TemplateItemRequest): Promise<void> => {
    setDraft((d) => ({ ...d, items: d.items.map((i) => (i.id === itemId ? { ...i, ...req } : i)) }));
    setEditingItem(null);
    scrollTo.current = itemId;
    return Promise.resolve();
  };
  const onRemove = (itemId: string) =>
    setDraft((d) => ({ ...d, items: d.items.filter((i) => i.id !== itemId) }));
  const onReorder = (arranged: DraftItem[]) => setDraft((d) => ({ ...d, items: arranged }));

  /**
   * Write the draft. There is no bulk endpoint, so the diff is replayed as the sequence the API
   * actually offers: rename → removals → edits → adds → order. Order LAST, because an add always
   * appends and the drag has to have the final say.
   *
   * If one op fails the ones before it stay landed, so the baseline is re-seeded from the last
   * answer the server gave and «Зберегти» retries only what is left. An add that landed also takes
   * the server's id and stops being new — otherwise the retry would add it a second time.
   */
  const save = async (): Promise<boolean> => {
    if (!canSave || saving) return false;
    setSaving(true);
    let name = baseline.name;
    let working = [...items];
    let latest = data;
    try {
      if (trimmed !== baseline.name) {
        follow(await rename.mutateAsync({ id: activeId, name: trimmed }));
        name = trimmed;
      }
      for (const gone of baseline.items.filter((b) => !working.some((i) => i.id === b.id))) {
        latest = (await removeItem.mutateAsync(gone.id)) ?? latest;
        follow(latest);
      }
      for (const it of working) {
        const was = baseline.items.find((b) => b.id === it.id);
        if (!was || sameItem(was, it)) continue;
        latest = (await updateItem.mutateAsync({ itemId: it.id, req: reqOf(it) })) ?? latest;
        follow(latest);
      }
      for (const it of working.filter((i) => i.isNew)) {
        const before = new Set((latest?.items ?? []).map((i) => i.id));
        const answer = await addItem.mutateAsync(reqOf(it));
        follow(answer);
        latest = answer ?? latest;
        // The created row is the one the previous answer did not have. Offline the optimistic
        // detail already carries our own uuid, so this resolves to the same row either way.
        const created = answer?.items.find((i) => !before.has(i.id));
        working = working.map((x) =>
          (x.id === it.id ? { ...x, id: created?.id ?? x.id, isNew: false } : x));
      }
      const onServer = latest?.items ?? [];
      const arranged = working
        .map((it) => onServer.find((s) => s.id === it.id))
        .filter((s): s is EstimateTemplateItemView => Boolean(s));
      if (arranged.length === working.length
        && arranged.some((s, i) => s.id !== onServer[i]?.id)) {
        latest = (await reorder.mutateAsync(arranged)) ?? latest;
        follow(latest);
      }
      toast.success(t('templates.saved'));
      // Every op landed, so the server now matches the draft — re-seed from what we WROTE, not
      // from `latest`: the answer to the last op predates the ones after it.
      setDraft({ name: trimmed, items: working });
      setBaseline({ name: trimmed, items: working });
      return true;
    } catch (err) {
      toast.error(toAppError(err).message);
      // `latest` is the answer to the last op that SUCCEEDED, so it describes the server exactly.
      setDraft({ name: draft.name, items: working });
      setBaseline({ name, items: latest?.items ?? baseline.items });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Cleared only once the row exists, so the scroll is never silently dropped if the render lags.
  // `editingItem` is a dependency because an edit submits from a sheet ON TOP of this one: while it
  // is open the row underneath cannot usefully be brought into view.
  useEffect(() => {
    const target = scrollTo.current;
    if (!target || editingItem) return;
    const row = document.querySelector(`[data-template-item-id="${target}"]`);
    if (!row) return;
    scrollTo.current = null;
    scrollRowIntoView(row);
  }, [items, editingItem]);

  const requestClose = () => (dirty ? setConfirmingClose(true) : onClose());
  const saveAndClose = async () => { if (await save()) onClose(); };

  return (
    <Modal open onClose={requestClose} title={t('templates.editTitle')} size="lg">
      {/* Name + Save */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Input
            value={draft.name}
            maxLength={255}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </div>
        <Button
          className="flex-shrink-0"
          data-testid="template-save"
          loading={saving}
          disabled={!canSave}
          onClick={() => void save()}
        >
          {t('common.save')}
        </Button>
      </div>
      <p className="mb-3 mt-1.5 text-[11px] text-muted">
        {dirty ? t('templates.unsavedHint') : t('templates.saveHint')}
      </p>

      {stillDefault && (
        <p className="mb-3 rounded-xl bg-brand-soft px-3 py-2 text-xs text-primary">
          {t('templates.defaultForkHint')}
        </p>
      )}

      {/* Composition — the order IS the sequence of works, so it is draggable. */}
      <div className="mb-3">
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
          <>
            <p className="mb-1.5 text-[11px] text-muted">{t('templates.sequenceHint')}</p>
            <Composition
              items={items}
              unsaved={unsaved}
              onEdit={setEditingItem}
              onRemove={(item) => setRemoving({ id: item.id, name: item.name })}
              onReorder={onReorder}
            />
          </>
        )}
      </div>

      {/* Add position — catalog (browse) or manual */}
      <div className="rounded-xl border border-border p-3">
        <TabSwitch tab={tab} onChange={setTab} />
        {tab === 'catalog' ? (
          <CatalogPicker existingNames={items.map((i) => i.name)} onPick={onAdd} />
        ) : (
          <ManualForm offerCatalogSave submitLabel={t('templates.addItem')} onSubmit={onAdd} />
        )}
      </div>

      {/* Edit ONE position — the same choice as everywhere: pick from the catalog or type it. */}
      {editingItem && (
        <PositionSheet
          item={editingItem}
          // Its own name stays out of the blocked set — the master may be re-picking the very same
          // position to correct its unit; everything ELSE in the bundle stays blocked, so an edit
          // cannot mint a duplicate name (two positions under one name merge on apply).
          existingNames={items.filter((i) => i.id !== editingItem.id).map((i) => i.name)}
          onSubmit={(req) => onUpdate(editingItem.id, req)}
          onClose={() => setEditingItem(null)}
        />
      )}

      <ConfirmDialog
        open={removing !== null}
        title={t('templates.removeItemTitle')}
        message={t('templates.removeItemConfirm', { name: removing?.name ?? '' })}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (removing) onRemove(removing.id);
          setRemoving(null);
        }}
        onClose={() => setRemoving(null)}
      />

      {/*
        Three answers, so not a ConfirmDialog: «зберегти» is the whole point of an explicit save,
        and offering only discard-or-cancel would turn the ✕ into a trap on a bundle just reworked.
      */}
      <Modal
        open={confirmingClose}
        onClose={() => setConfirmingClose(false)}
        title={t('templates.unsavedTitle')}
      >
        <p className="mb-5 text-sm text-muted">{t('templates.unsavedMessage')}</p>
        <div className="space-y-2">
          <Button fullWidth loading={saving} disabled={!canSave} onClick={() => void saveAndClose()}>
            {t('common.save')}
          </Button>
          <Button variant="secondary" fullWidth onClick={onClose}>
            {t('templates.discard')}
          </Button>
          <Button variant="ghost" fullWidth onClick={() => setConfirmingClose(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Modal>
    </Modal>
  );
}

function TabSwitch({ tab, onChange }: { tab: AddTab; onChange: (next: AddTab) => void }) {
  const { t } = useTranslation();
  return (
    <div className="mb-3 flex gap-1 rounded-xl bg-surface-sunken p-1">
      {(['catalog', 'manual'] as AddTab[]).map((tabKey) => (
        <button
          key={tabKey}
          type="button"
          onClick={() => onChange(tabKey)}
          className={cn(
            'flex-1 rounded-lg py-2 text-sm font-semibold transition-colors',
            tab === tabKey ? 'bg-surface text-primary shadow-card' : 'text-muted',
          )}
        >
          {tabKey === 'catalog' ? t('templates.addFromCatalog') : t('templates.addManual')}
        </button>
      ))}
    </div>
  );
}

/** The draggable composition. A drag rearranges the DRAFT; nothing is written until «Зберегти». */
function Composition({
  items,
  unsaved,
  onEdit,
  onRemove,
  onReorder,
}: {
  items: DraftItem[];
  unsaved: ReadonlySet<string>;
  onEdit: (item: DraftItem) => void;
  onRemove: (item: DraftItem) => void;
  onReorder: (arranged: DraftItem[]) => void;
}) {
  const sensors = useSensors(
    // 8px before a drag begins: a tap on the grip still registers as a tap, and a swipe to scroll
    // the list is not stolen. The grip also sets touch-action:none so the browser does not scroll.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.id === active.id);
    const to = items.findIndex((i) => i.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(items, from, to));
  };

  return (
    <div className="max-h-[32dvh] space-y-1 overflow-y-auto">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          {items.map((item, index) => (
            <SortableRow
              key={item.id}
              item={item}
              number={index + 1}
              unsaved={unsaved.has(item.id)}
              onEdit={() => onEdit(item)}
              onRemove={() => onRemove(item)}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableRow({
  item,
  number,
  unsaved,
  onEdit,
  onRemove,
}: {
  item: DraftItem;
  number: number;
  unsaved: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  return (
    <div
      ref={setNodeRef}
      // The anchor the editor scrolls a just-added/edited position to.
      data-template-item-id={item.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('flex items-stretch gap-1', isDragging && 'z-10 opacity-90')}
    >
      <DragGrip listeners={listeners} attributes={attributes} label={t('templates.dragItem')} stretch />
      <button
        type="button"
        onClick={onEdit}
        className={cn(
          'flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm',
          unsaved
            ? 'border-success/50 bg-success-soft'
            : 'border-transparent bg-surface-sunken',
        )}
      >
        <span className="min-w-0 break-words text-primary">
          <span className="mr-1.5 text-xs font-semibold text-faint">{number}.</span>
          {item.name}
        </span>
        <span className="flex-shrink-0 text-xs text-muted">{t('units.' + item.unit)}</span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('templates.removeItem')}
        className="flex w-8 flex-shrink-0 items-center justify-center text-base text-muted"
      >
        🗑
      </button>
    </div>
  );
}

/** Edit ONE position — the same two ways a position is chosen everywhere else in the app. */
function PositionSheet({
  item,
  existingNames,
  onSubmit,
  onClose,
}: {
  item: DraftItem;
  existingNames: string[];
  onSubmit: (req: TemplateItemRequest) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // Opens on MANUAL: an edit usually starts from what is already there, and that tab shows it.
  const [tab, setTab] = useState<AddTab>('manual');
  return (
    <Modal open onClose={onClose} title={t('templates.editItemTitle')}>
      <TabSwitch tab={tab} onChange={setTab} />
      {tab === 'catalog' ? (
        <>
          <p className="mb-2 text-xs text-muted">{t('templates.pickReplacement')}</p>
          <CatalogPicker existingNames={existingNames} onPick={onSubmit} single />
        </>
      ) : (
        <ManualForm
          initial={{ name: item.name, type: item.type, unit: item.unit }}
          submitLabel={t('common.save')}
          onSubmit={onSubmit}
        />
      )}
    </Modal>
  );
}

/**
 * Browse the catalog, filter by trade (2+ trades) + name, then take positions into the template
 * (name+type+unit only — no quantity/price; those are resolved when the template is applied).
 * Positions already in the bundle are shown disabled so they can't be added twice.
 *
 * `single` turns it into a replacement picker for ONE position: a tap applies straight away, with
 * no basket to confirm — there is nothing to accumulate when only one position can win.
 */
function CatalogPicker({
  existingNames,
  onPick,
  single,
}: {
  existingNames: string[];
  onPick: (req: TemplateItemRequest) => Promise<void>;
  single?: boolean;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const { data, isPending } = useCatalog();
  const [q, setQ] = useState('');
  const [tradeFilter, setTradeFilter] = useState<Set<TradeKey>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

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

  const pickOne = async (itemId: string) => {
    const item = (data ?? []).find((i) => i.id === itemId);
    if (!item || busy) return;
    setBusy(true);
    try {
      await onPick({ name: item.name, type: item.type, unit: item.unit });
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const addSelected = async () => {
    if (selected.size === 0) return;
    const picks = (data ?? []).filter((i) => selected.has(i.id));
    setBusy(true);
    try {
      // No batch endpoint for template items — append one by one (the server assigns
      // the next sort order each time). Sequential so order is stable.
      for (const item of picks) {
        await onPick({ name: item.name, type: item.type, unit: item.unit });
      }
      toast.success(t('estimate.itemsAdded', { count: picks.length }));
      setSelected(new Set());
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setBusy(false);
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
                disabled={already || (Boolean(single) && busy)}
                onClick={() => (single ? void pickOne(item.id) : toggle(item.id))}
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
                  {!single && (
                    <span
                      className={cn(
                        'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border text-xs',
                        checked
                          ? 'border-brand bg-brand text-white'
                          : 'border-border text-transparent',
                      )}
                    >
                      ✓
                    </span>
                  )}
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

      {!single && selected.size > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <Button fullWidth loading={busy} onClick={addSelected}>
            {t('estimate.addNItems', { count: selected.size })}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Type a position by hand (name + type + unit) — both for adding one the catalog doesn't have and
 * for correcting one already in the bundle.
 *
 * `offerCatalogSave` applies to ADDING only: a freshly invented position has no price anywhere, so
 * the catalog prompt is what stops the template applying it at 0 ₴ later. An edit is left alone —
 * there the master is fixing wording, not inventing a job.
 */
function ManualForm({
  initial,
  submitLabel,
  offerCatalogSave,
  onSubmit,
}: {
  initial?: TemplateItemRequest;
  submitLabel: string;
  offerCatalogSave?: boolean;
  onSubmit: (req: TemplateItemRequest) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<ItemType>(initial?.type ?? 'WORK');
  const [unit, setUnit] = useState<Unit>(initial?.unit ?? 'M2');
  const [busy, setBusy] = useState(false);
  const [savePrompt, setSavePrompt] = useState<CatalogSaveDraft | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSubmit({ name: name.trim(), type, unit });
      if (offerCatalogSave) {
        setSavePrompt({ name: name.trim(), type, unit });
        setName('');
        setType('WORK');
        setUnit('M2');
      }
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setBusy(false);
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
      <Button fullWidth loading={busy} onClick={submit}>
        {submitLabel}
      </Button>
    </div>
  );
}
