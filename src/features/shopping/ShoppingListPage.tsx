import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { onlineManager } from '@tanstack/react-query';
import { Button } from '@/components/Button.tsx';
import { Input } from '@/components/Input.tsx';
import { Select } from '@/components/Select.tsx';
import { Modal } from '@/components/Modal.tsx';
import { FormField } from '@/components/FormField.tsx';
import { Spinner } from '@/components/Spinner.tsx';
import { EmptyState } from '@/components/EmptyState.tsx';
import { OfflineNotCached } from '@/components/OfflineNotCached.tsx';
import { CollapseGroupRow } from '@/components/CollapseGroupRow.tsx';
import { toast } from '@/hooks/useToast.ts';
import { useOnlineGuard } from '@/hooks/useOnlineGuard.ts';
import { formatNumber } from '@/lib/format.ts';
import { sharePdf } from '@/lib/sharePdf.ts';
import { routes } from '@/lib/config.ts';
import { shoppingApi } from '@/api/shopping.ts';
import { UNITS } from '@/api/types.ts';
import type { ShoppingListItemResponse, Unit } from '@/api/types.ts';
import { useShoppingActions, useShoppingList } from './useShoppingList.ts';

/**
 * «Список покупок» — what to buy for this object, one screen, no prices.
 *
 * The screen is designed for the place it is used: a builders' merchant, one hand on a trolley,
 * often with no signal at all. So every row is a fat tap target, the bought rows fold away rather
 * than scroll past, and nothing here needs the network — writes queue through the outbox.
 *
 * The one deliberate exception is «Поділитись списком»: it asks the server for a PDF, so it is
 * online-gated and visibly disabled rather than failing in a basement at the merchant.
 *
 * <p><b>«Додати чек» stood at the bottom and is deliberately GONE (2026-09-11).</b> Nothing about
 * «Чеки обʼєкта» (V129) was removed — the screen, its route and its endpoints all stand; only this
 * entry point is withdrawn, until masters ask for it instead of us assuming they want it. Know the
 * consequence before restoring it: the economy tab's 🧾 card renders nothing while
 * `receiptCount === 0`, so a master with no receipts yet now has no way in from the object at all,
 * while one who already has some keeps his card and loses nothing.</p>
 *
 * Three screens open this one — the home card, the object row and the calculator — so «←» goes
 * back to the one that did (`state.from`), not always to the object. The object stays the
 * fallback: a shared link or a reload loses the state, and the list belongs to an object anyway.
 */
export function ShoppingListPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  const list = useShoppingList(projectId);
  const actions = useShoppingActions(projectId);

  // Bought rows start EXPANDED: folded away they read as gone, and the master checking what he
  // has already put in the trolley is the second thing this screen is for.
  const [boughtOpen, setBoughtOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ShoppingListItemResponse | null>(null);
  const [sharing, setSharing] = useState(false);
  const { online, guard, offlineTitle } = useOnlineGuard();

  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const open = useMemo(
    () => items.filter((i) => !i.bought).sort((a, b) => a.sortOrder - b.sortOrder),
    [items],
  );
  const bought = useMemo(
    () => items.filter((i) => i.bought).sort((a, b) => a.sortOrder - b.sortOrder),
    [items],
  );
  const back = (location.state as { from?: string } | null)?.from ?? routes.project(projectId);
  const archived = Boolean(list.data?.archivedAt);

  const toggle = (item: ShoppingListItemResponse) => {
    if (archived) return;
    actions.update.mutate({ itemId: item.id, req: { bought: !item.bought } });
  };

  // The answer to a parked recalculation figure. Either way the offer goes; «взяти нове» also
  // hands the row back to the calculator, which is the whole point of asking rather than applying.
  const answer = (item: ShoppingListItemResponse, suggestion: 'ACCEPT' | 'KEEP_MINE') => {
    if (archived) return;
    actions.update.mutate({ itemId: item.id, req: { suggestion } });
  };

  // «Скинув список клієнту і все» — the master's own words for the case where the client buys the
  // materials himself. A PDF rather than pasted text: a document with his company on it is what a
  // client forwards to a shop, and the server deliberately renders it WITHOUT prices (V126/V81).
  const share = guard(async () => {
    setSharing(true);
    try {
      const blob = await shoppingApi.fetchPdfBlob(projectId);
      await sharePdf(blob, `${t('shopping.shareFileName')}.pdf`, t('shopping.title'));
    } catch {
      toast.error(t('shopping.shareFailed'));
    } finally {
      setSharing(false);
    }
  });

  if (list.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas">
        <Spinner />
      </div>
    );
  }

  const notCached = list.isError && !onlineManager.isOnline();

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto max-w-xl px-4 pb-28 pt-4 sm:px-6">
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(back)}
            aria-label={t('common.back')}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-lg text-primary"
          >
            ←
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold tracking-tight text-primary">
              {t('shopping.title')}
            </h1>
            <p className="truncate text-xs text-muted">
              {list.data?.projectName}
              {items.length > 0 && (
                <> · {t('shopping.counts', { total: items.length, bought: bought.length })}</>
              )}
            </p>
          </div>
        </div>

        {archived && (
          <p className="mb-4 rounded-xl border border-dashed border-border px-3 py-2.5 text-center text-xs text-muted">
            {t('shopping.archived')}
          </p>
        )}

        {/* A hint, never a gate: the estimate can still move, and nothing here is blocked because of it. */}
        {!archived && list.data?.sourceEstimateUnsigned && (
          <p className="mb-4 rounded-xl border border-border bg-surface px-3 py-2.5 text-xs text-muted">
            {t('shopping.unsignedSource')}
          </p>
        )}

        {notCached ? (
          <OfflineNotCached what={t('shopping.title')} />
        ) : items.length === 0 ? (
          <EmptyState
            icon="🛒"
            title={t('shopping.emptyTitle')}
            text={t('shopping.emptyText')}
            action={
              <Button onClick={() => setAdding(true)} disabled={archived}>
                {t('shopping.addItem')}
              </Button>
            }
          />
        ) : (
          <div className="overflow-hidden rounded-card border border-border bg-surface">
            {open.map((item) => (
              <ShoppingRow
                key={item.id}
                item={item}
                disabled={archived}
                onToggle={() => toggle(item)}
                onEdit={() => setEditing(item)}
                onAnswer={(suggestion) => answer(item, suggestion)}
              />
            ))}
            {bought.length > 0 && (
              <CollapseGroupRow
                label={t('shopping.boughtGroup', { count: bought.length })}
                expanded={boughtOpen}
                onToggle={() => setBoughtOpen((v) => !v)}
              />
            )}
            {boughtOpen && bought.map((item) => (
              <ShoppingRow
                key={item.id}
                item={item}
                disabled={archived}
                onToggle={() => toggle(item)}
                onEdit={() => setEditing(item)}
                onAnswer={(suggestion) => answer(item, suggestion)}
              />
            ))}
          </div>
        )}

        {items.length > 0 && !archived && (
          <div className="mt-4 space-y-2">
            <Button variant="secondary" fullWidth onClick={() => setAdding(true)}>
              {t('shopping.addItem')}
            </Button>
            {/* Online-only and visibly so: this one really does go to the server for a document. */}
            <Button
              variant="secondary"
              fullWidth
              loading={sharing}
              disabled={!online}
              title={offlineTitle}
              onClick={share}
            >
              📤 {t('shopping.share')}
            </Button>
            {bought.length > 0 && (
              <Button variant="ghost" fullWidth onClick={() => actions.clearBought.mutate()}>
                {t('shopping.clearBought')}
              </Button>
            )}
          </div>
        )}
      </div>

      <AddItemModal
        open={adding}
        onClose={() => setAdding(false)}
        onSubmit={(req) => {
          actions.add.mutate(req);
          setAdding(false);
        }}
      />
      <EditItemModal
        item={editing}
        onClose={() => setEditing(null)}
        onSave={(quantity, note) => {
          if (editing) actions.update.mutate({ itemId: editing.id, req: { quantity, note } });
          setEditing(null);
        }}
        onDelete={() => {
          if (editing) actions.remove.mutate(editing.id);
          setEditing(null);
        }}
      />
    </div>
  );
}

/**
 * One row: a 56 px tap target, because the hand holding the phone is in a work glove. The tick and
 * the row body are SIBLINGS, not nested buttons — tapping the box buys, tapping the name edits.
 */
function ShoppingRow({
  item,
  disabled,
  onToggle,
  onEdit,
  onAnswer,
}: {
  item: ShoppingListItemResponse;
  disabled: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onAnswer: (suggestion: 'ACCEPT' | 'KEEP_MINE') => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex min-h-[56px] items-center">
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          aria-pressed={item.bought}
          aria-label={item.name}
          className="flex h-14 w-14 flex-shrink-0 items-center justify-center"
        >
          <span
            className={
              item.bought
                ? 'flex h-6 w-6 items-center justify-center rounded-md bg-success text-sm text-white'
                : 'flex h-6 w-6 items-center justify-center rounded-md border-2 border-border'
            }
            aria-hidden
          >
            {item.bought ? '✓' : ''}
          </span>
        </button>
        <button
          type="button"
          onClick={onEdit}
          disabled={disabled}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span
              className={
                item.bought
                  ? 'block truncate text-sm text-muted line-through'
                  : 'block truncate text-sm font-medium text-primary'
              }
            >
              {item.name}
            </span>
            {item.note && <span className="block truncate text-xs text-muted">{item.note}</span>}
            {item.topUp && (
              <span className="block text-xs text-muted">{t('shopping.topUpWhy')}</span>
            )}
          </span>
          <span className="flex-shrink-0 font-mono text-sm tabular-nums text-primary">
            {/* «ще 6» — beside a bought 12, a bare «6» reads as our arithmetic having slipped. */}
            {item.topUp && <span className="text-muted">{t('shopping.topUpPrefix')} </span>}
            {formatNumber(item.quantity, 3)} {t(`units.${item.unit}`)}
          </span>
        </button>
      </div>
      {item.suggestedQuantity != null && (
        <div className="rounded-xl bg-amber-soft px-3 py-2.5 mx-3 mb-3">
          <p className="text-xs text-amber">
            {t('shopping.suggestion', {
              qty: formatNumber(item.suggestedQuantity, 3),
              unit: t(`units.${item.unit}`),
            })}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => onAnswer('ACCEPT')}
              disabled={disabled}
              className="min-h-11 flex-1 rounded-xl bg-surface px-3 text-sm font-semibold text-primary"
            >
              {t('shopping.takeNew')}
            </button>
            <button
              type="button"
              onClick={() => onAnswer('KEEP_MINE')}
              disabled={disabled}
              className="min-h-11 flex-1 rounded-xl px-3 text-sm font-medium text-amber"
            >
              {t('shopping.keepMine')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddItemModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (req: { name: string; unit: Unit; quantity: number }) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<Unit>('PIECE');
  const [quantity, setQuantity] = useState('1');

  const submit = () => {
    const qty = Number(quantity.replace(',', '.'));
    if (!name.trim()) {
      toast.error(t('shopping.enterName'));
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error(t('shopping.enterQuantity'));
      return;
    }
    onSubmit({ name: name.trim(), unit, quantity: qty });
    setName('');
    setQuantity('1');
  };

  return (
    <Modal open={open} onClose={onClose} title={t('shopping.addItem')}>
      <div className="space-y-3">
        <FormField label={t('common.name')} htmlFor="sl-name" required>
          <Input id="sl-name" value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('shopping.quantity')} htmlFor="sl-qty" required>
            <Input
              id="sl-qty"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </FormField>
          <FormField label={t('shopping.unit')} htmlFor="sl-unit" required>
            <Select id="sl-unit" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>{t(`unitOptions.${u}`)}</option>
              ))}
            </Select>
          </FormField>
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="secondary" fullWidth onClick={onClose}>{t('common.cancel')}</Button>
          <Button fullWidth onClick={submit}>{t('common.add')}</Button>
        </div>
      </div>
    </Modal>
  );
}

function EditItemModal({
  item,
  onClose,
  onSave,
  onDelete,
}: {
  item: ShoppingListItemResponse | null;
  onClose: () => void;
  onSave: (quantity: number, note: string) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [loaded, setLoaded] = useState<string | null>(null);

  // Seed the form from the row the master tapped, once per row — re-seeding a controlled input on
  // every render would make it impossible to type.
  if (item && loaded !== item.id) {
    setLoaded(item.id);
    setQuantity(String(item.quantity));
    setNote(item.note ?? '');
  }

  const save = () => {
    const qty = Number(quantity.replace(',', '.'));
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error(t('shopping.enterQuantity'));
      return;
    }
    onSave(qty, note.trim());
  };

  return (
    <Modal open={Boolean(item)} onClose={onClose} title={item?.name ?? ''}>
      <div className="space-y-3">
        <FormField
          label={t('shopping.quantity')}
          htmlFor="sl-edit-qty"
          hint={item?.source === 'CALCULATOR' ? t('shopping.editedHint') : undefined}
          required
        >
          <Input
            id="sl-edit-qty"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </FormField>
        <FormField label={t('shopping.note')} htmlFor="sl-edit-note">
          <Input id="sl-edit-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
        <div className="flex gap-2 pt-1">
          <Button variant="ghost" onClick={onDelete}>{t('common.delete')}</Button>
          <Button fullWidth onClick={save}>{t('common.save')}</Button>
        </div>
      </div>
    </Modal>
  );
}
