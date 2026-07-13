import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from '@/components/Spinner.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { UpgradeIntentModal } from '@/features/upgrade/UpgradeIntentModal.tsx';
import { useMe } from '@/features/auth/useMe.ts';
import { upgradeApi } from '@/api/upgrade.ts';
import { formatMoney } from '@/lib/format.ts';
import { cn } from '@/lib/cn.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { useEconomy, useExpenses, useDeleteExpense } from './useEconomy.ts';
import { ExpenseSheet } from './ExpenseSheet.tsx';
import type { ExpenseCategory, ExpenseResponse } from '@/api/types.ts';

const CAT_ICON: Record<ExpenseCategory, string> = { MATERIALS: '🧱', LABOR: '🔨', OTHER: '•' };

/** A small reference figure (label + amount) in the economy breakdown. */
function EcoRef({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-sm font-bold text-primary">{formatMoney(value)}</div>
      <div className="mt-0.5 text-[11px] text-muted">{label}</div>
    </div>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
}

/**
 * "Object economy" (PRO): income (from the object's estimates) − expenses = real
 * profit. FREE masters see a locked teaser (no real numbers) that opens the upgrade
 * modal with the OBJECT_PROFIT trigger. Owner-only; nothing here reaches the client.
 */
export function ObjectEconomySection({ objectId }: { objectId: string }) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const isPro = (me?.plan ?? 'FREE') !== 'FREE';

  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseResponse | null>(null);
  const [deleting, setDeleting] = useState<ExpenseResponse | null>(null);

  const economy = useEconomy(objectId, isPro);
  const expenses = useExpenses(objectId, isPro);
  const del = useDeleteExpense(objectId);

  const openTeaser = () => {
    void upgradeApi.click('OBJECT_PROFIT');
    setUpgradeOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await del.mutateAsync(deleting.id);
      setDeleting(null);
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  // ---- FREE teaser: locked, no real figures --------------------------------
  if (!isPro) {
    return (
      <section className="mt-6">
        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-primary">
          {t('economy.title')}
        </h2>
        <button
          type="button"
          onClick={openTeaser}
          className="flex w-full items-center gap-3 rounded-card border border-dashed border-border bg-surface p-4 text-left"
        >
          <span className="text-2xl">🔒</span>
          <span className="flex-1">
            <span className="block text-sm font-semibold text-primary">{t('economy.teaser')}</span>
            <span className="mt-0.5 block text-xs font-bold text-brand">{t('economy.openPro')}</span>
          </span>
        </button>
        <UpgradeIntentModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
      </section>
    );
  }

  // ---- PRO panel -----------------------------------------------------------
  const eco = economy.data;
  const list = expenses.data ?? [];
  const profit = eco?.profit ?? 0;
  const cash = eco?.cashBalance ?? 0;

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-bold uppercase tracking-wide text-primary">{t('economy.title')}</h2>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setSheetOpen(true);
          }}
          className="text-[13px] font-semibold text-brand"
        >
          {t('economy.addExpenseShort')}
        </button>
      </div>

      {economy.isPending ? (
        <div className="py-6 text-center">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="rounded-card border border-border bg-surface p-3">
            {/* The two figures that matter: earnings (labour − unforeseen) and the
                materials cash pot (deposit − receipts, red when out of pocket). */}
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl bg-surface-sunken p-2">
                <div className={cn('text-base font-extrabold', profit < 0 ? 'text-danger' : 'text-brand')}>
                  {formatMoney(profit)}
                </div>
                <div className="mt-0.5 text-[11px] font-semibold text-primary">{t('economy.profit')}</div>
              </div>
              <div className="rounded-xl bg-surface-sunken p-2">
                <div className={cn('text-base font-extrabold', cash < 0 ? 'text-danger' : 'text-primary')}>
                  {formatMoney(cash)}
                </div>
                <div className="mt-0.5 text-[11px] font-semibold text-primary">{t('economy.cash')}</div>
              </div>
            </div>

            {/* Reference breakdown. */}
            <div className="mt-3 grid grid-cols-3 gap-x-2 gap-y-2 text-center">
              <EcoRef label={t('economy.contracted')} value={(eco?.works ?? 0) + (eco?.materials ?? 0)} />
              <EcoRef label={t('economy.works')} value={eco?.works ?? 0} />
              <EcoRef label={t('economy.materials')} value={eco?.materials ?? 0} />
              <EcoRef label={t('economy.received')} value={eco?.received ?? 0} />
              <EcoRef label={t('economy.spentReceipts')} value={eco?.spentReceipts ?? 0} />
              <EcoRef label={t('economy.spentManual')} value={eco?.spentManual ?? 0} />
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            {list.map((e) => (
              <div key={e.id} className="flex items-stretch rounded-xl border border-border bg-surface">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(e);
                    setSheetOpen(true);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left"
                >
                  <span className="text-lg">{CAT_ICON[e.category]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-primary">{formatMoney(e.amount)}</span>
                    <span className="block truncate text-xs text-muted">
                      {fmtDate(e.spentAt)}
                      {e.note ? ` · ${e.note}` : ''}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={t('common.delete')}
                  onClick={() => setDeleting(e)}
                  className="flex items-center border-l border-border px-3 text-muted"
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <ExpenseSheet open={sheetOpen} onClose={() => setSheetOpen(false)} objectId={objectId} editing={editing} />
      <ConfirmDialog
        open={deleting !== null}
        title={t('economy.deleteTitle')}
        message={t('economy.deleteMessage')}
        confirmLabel={t('common.delete')}
        loading={del.isPending}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}
